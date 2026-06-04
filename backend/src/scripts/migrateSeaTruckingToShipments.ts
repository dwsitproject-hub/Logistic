/**
 * Move misrouted SEA contracts out of trucking_operations into shipments.
 *
 * Run: cd backend && npx ts-node src/scripts/migrateSeaTruckingToShipments.ts
 * Diagnostics (no changes): cd backend && npx ts-node src/scripts/migrateSeaTruckingToShipments.ts 1004027007
 */

import { getClient } from '../database/connection';
import logger from '../utils/logger';

/**
 * Source of truth for SEA/LAND classification: contracts.transport_mode
 * (per user request; do not infer from SAP fields here).
 */
const isSeaContractSql = `UPPER(TRIM(COALESCE(c.transport_mode, ''))) LIKE 'SEA%'`;

async function diagnostics(client: any, contractIdOrExtNo: string) {
  const key = String(contractIdOrExtNo ?? '').trim();
  const { rows: dbInfo } = await client.query(
    `SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port`
  );
  console.log('[db]', JSON.stringify(dbInfo[0] || {}, null, 2));

  const { rows: directHits } = await client.query(
    `
    SELECT id AS contract_uuid, contract_id, transport_mode, sto_number
    FROM contracts
    WHERE TRIM(contract_id::text) = TRIM($1::text)
       OR contract_id ILIKE $2
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 10
    `,
    [key, `%${key}%`]
  );
  console.log('[contracts direct]', JSON.stringify(directHits, null, 2));

  const { rows: extToContractNumber } = await client.query(
    `
    SELECT DISTINCT ON (spd.contract_number)
      spd.contract_number,
      COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
    FROM sap_processed_data spd
    WHERE TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) ILIKE $1
    ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    LIMIT 10
    `,
    [`%${key}%`]
  );
  console.log('[sap ext→contract_number]', JSON.stringify(extToContractNumber, null, 2));

  const { rows: contractRows } = await client.query(
    `
    WITH latest_spd AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
      FROM sap_processed_data spd
      WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number::text) != ''
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    )
    SELECT
      c.id AS contract_uuid,
      c.contract_id,
      c.transport_mode,
      l.contract_ext_no
    FROM contracts c
    LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
    WHERE TRIM(c.contract_id::text) = TRIM($1::text)
       OR c.contract_id ILIKE $2
       OR TRIM(COALESCE(l.contract_ext_no, '')) = TRIM($1::text)
       OR LOWER(TRIM(COALESCE(l.contract_ext_no, ''))) = LOWER(TRIM($1::text))
    ORDER BY (c.contract_id = $1) DESC
    LIMIT 5
    `,
    [key, `%${key}%`]
  );
  console.log('[contracts match]', JSON.stringify(contractRows, null, 2));

  const cu = contractRows[0]?.contract_uuid as string | undefined;
  if (!cu) return;

  const { rows: counts } = await client.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM trucking_operations t WHERE t.contract_id = $1::uuid) AS trucking_count,
      (SELECT COUNT(*)::int FROM shipments s WHERE s.contract_id = $1::uuid) AS shipment_count
    `,
    [cu]
  );
  console.log('[counts]', JSON.stringify(counts[0] || {}, null, 2));

  const { rows: truckingSample } = await client.query(
    `
    SELECT id, operation_id, created_at, shipment_id
    FROM trucking_operations
    WHERE contract_id = $1::uuid
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
    `,
    [cu]
  );
  console.log('[trucking sample]', JSON.stringify(truckingSample, null, 2));

  const { rows: shipmentSample } = await client.query(
    `
    SELECT id, shipment_id, operation_id, created_at
    FROM shipments
    WHERE contract_id = $1::uuid
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
    `,
    [cu]
  );
  console.log('[shipment sample]', JSON.stringify(shipmentSample, null, 2));
}

async function migrate() {
  const client = await getClient();
  let inserted = 0;
  let deleted = 0;
  let docPatched = 0;
  let orphanDeleted = 0;

  try {
    await client.query('BEGIN');

    // Diagnostics-only mode (no DB writes)
    const arg = process.argv[2];
    if (arg && String(arg).trim()) {
      await client.query('ROLLBACK');
      await diagnostics(client, arg);
      logger.info('Diagnostics only (no migration applied). Run without args to migrate.');
      return;
    }

    const { rows: preCounts } = await client.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM trucking_operations t INNER JOIN contracts c ON c.id = t.contract_id WHERE ${isSeaContractSql}) AS sea_trucking_rows,
        (SELECT COUNT(*)::int FROM shipments s INNER JOIN contracts c ON c.id = s.contract_id WHERE ${isSeaContractSql}) AS sea_shipments_rows
      `
    );
    logger.info('Pre-migration counts', preCounts[0] || {});

    const { rows: candidates } = await client.query<{ tid: string }>(
      `
      SELECT DISTINCT ON (c.id)
        t.id AS tid
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE ${isSeaContractSql}
        AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id)
      ORDER BY c.id, t.created_at ASC
      `
    );

    for (const row of candidates) {
      const q = await client.query(
        `
        SELECT
          c.id,
          c.quantity_ordered,
          t.created_at,
          t.quantity_sent,
          t.quantity_delivered,
          t.id AS trucking_id,
          TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY') AS dmy,
          (
            SELECT COUNT(*)::int
            FROM shipments s2
            WHERE s2.operation_id LIKE ('OP-SEA-' || TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY') || '%')
          ) AS existing_op_prefix_count
        FROM trucking_operations t
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE t.id = $1::uuid
        `,
        [row.tid]
      );
      const r = q.rows[0] as {
        id: string;
        quantity_ordered: unknown;
        created_at: unknown;
        quantity_sent: unknown;
        quantity_delivered: unknown;
        trucking_id: string;
        dmy: string;
        existing_op_prefix_count: number;
      };
      if (!r) continue;

      const seq = Number(r.existing_op_prefix_count ?? 0) + 1;
      const shipIns = await client.query(
        `
        INSERT INTO shipments (
          shipment_id,
          contract_id,
          operation_id,
          status,
          quantity_shipped,
          quantity_delivered,
          created_at,
          updated_at
        )
        VALUES (
          'MSEA-' || SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', ''), 1, 24),
          $1::uuid,
          'OP-SEA-' || $2::text || (CASE WHEN $3::int < 10000 THEN LPAD($3::text, 4, '0') ELSE $3::text END),
          'PLANNED',
          COALESCE($4::numeric, $5::numeric, $6::numeric),
          COALESCE($5::numeric, $4::numeric),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id
        `,
        [
          r.id,
          r.dmy,
          seq,
          r.quantity_sent,
          r.quantity_delivered,
          r.quantity_ordered,
        ]
      );
      const shipmentUuid = shipIns.rows[0]?.id as string;
      inserted += 1;

      const docRes = await client.query(
        `
        UPDATE documents
        SET shipment_id = $1::uuid,
            trucking_operation_id = NULL
        WHERE trucking_operation_id = $2::uuid
        `,
        [shipmentUuid, r.trucking_id]
      );
      docPatched += docRes.rowCount ?? 0;

      await client.query(`DELETE FROM trucking_operations WHERE id = $1::uuid`, [r.trucking_id]);
      deleted += 1;
    }

    const { rows: orphanTids } = await client.query<{ id: string }>(
      `
      SELECT t.id
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE ${isSeaContractSql}
        AND EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id)
      `
    );

    for (const { id: truckingId } of orphanTids) {
      const up = await client.query(
        `
        UPDATE documents d
        SET shipment_id = (
          SELECT s.id FROM shipments s
          WHERE s.contract_id = (SELECT contract_id FROM trucking_operations WHERE id = $1::uuid)
          ORDER BY s.created_at DESC NULLS LAST
          LIMIT 1
        ),
        trucking_operation_id = NULL
        WHERE d.trucking_operation_id = $1::uuid
        `,
        [truckingId]
      );
      docPatched += up.rowCount ?? 0;

      await client.query(`DELETE FROM trucking_operations WHERE id = $1::uuid`, [truckingId]);
      orphanDeleted += 1;
    }

    await client.query('COMMIT');

    logger.info('migrateSeaTruckingToShipments done', {
      insertedShipments: inserted,
      truckingDeletedWithInsert: deleted,
      orphanTruckingDeleted: orphanDeleted,
      documentsRepointed: docPatched,
    });
    console.log(
      JSON.stringify(
        {
          success: true,
          insertedShipments: inserted,
          truckingDeletedWithInsert: deleted,
          orphanTruckingDeleted: orphanDeleted,
          documentsRepointed: docPatched,
        },
        null,
        2
      )
    );
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('migrateSeaTruckingToShipments failed', e);
    throw e;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default migrate;
