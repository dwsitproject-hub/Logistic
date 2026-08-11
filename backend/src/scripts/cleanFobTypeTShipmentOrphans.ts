/**
 * Remove FOB + STO Type T rows from Shipments (truck legs — not sea execution).
 *
 * Trucking page is FRC/LCO only; these STOs must not appear in Shipments or Trucking.
 * Deletes linked vessel_loading_ports, trucking_operations (if any), then shipment rows.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanFobTypeTShipmentOrphans.ts --dry-run
 *   npx ts-node src/scripts/cleanFobTypeTShipmentOrphans.ts
 *   npx ts-node src/scripts/cleanFobTypeTShipmentOrphans.ts --dry-run --sto 1586004914
 * Docker (after backend build): docker exec klip-backend node dist/scripts/cleanFobTypeTShipmentOrphans.js --dry-run
 */
import { getClient } from '../database/connection';
import logger from '../utils/logger';
import {
  shipmentListStoKeyExpr,
  shipmentResolvedStoTypeExpr,
} from '../utils/shipmentStoTypeSql';

interface OrphanRow {
  id: string;
  shipment_id: string | null;
  contract_id: string;
  incoterm: string | null;
  sto_type: string;
  status: string | null;
}

function parseArgs(): { dryRun: boolean; sto: string | null; includeManual: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const includeManual = args.includes('--include-manual');
  const stoIdx = args.indexOf('--sto');
  const sto = stoIdx >= 0 ? String(args[stoIdx + 1] ?? '').trim() || null : null;
  if (stoIdx >= 0 && !sto) {
    throw new Error('--sto requires a STO number');
  }
  return { dryRun, sto, includeManual };
}

function buildOrphanSelectSql(stoFilter: string | null, includeManual: boolean): string {
  const stoTypeExpr = shipmentResolvedStoTypeExpr('c', 'l', 's');
  const stoKeyExpr = shipmentListStoKeyExpr('c', 'l', 's');
  const manualExclude = includeManual
    ? ''
    : `AND COALESCE(s.shipment_id::text, '') NOT LIKE 'MNL-%'
       AND COALESCE(s.shipment_id::text, '') NOT LIKE 'MSEA-%'`;

  const stoScope = stoFilter
    ? `AND (
        TRIM(COALESCE(s.shipment_id::text, '')) = $1
        OR TRIM((${stoKeyExpr})::text) = $1
      )`
    : '';

  return `
    WITH latest_spd_contract AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        NULLIF(TRIM(COALESCE(
          spd.sto_number::text,
          spd.data->'raw'->>'STO No.',
          spd.data->'raw'->>'STO Number',
          spd.data->'shipment'->>'sto_no',
          spd.data->'contract'->>'sto_no'
        )), '') AS effective_sto
      FROM sap_processed_data spd
      WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    )
    SELECT
      s.id,
      s.shipment_id,
      c.contract_id,
      c.incoterm,
      ${stoTypeExpr} AS sto_type,
      s.status
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    WHERE UPPER(TRIM(COALESCE(c.incoterm, ''))) = 'FOB'
      AND ${stoTypeExpr} = 'T'
      ${manualExclude}
      ${stoScope}
    ORDER BY s.shipment_id, c.contract_id`;
}

async function main(): Promise<void> {
  const { dryRun, sto, includeManual } = parseArgs();
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const selectSql = buildOrphanSelectSql(sto, includeManual);
    const params = sto ? [sto] : [];
    const { rows } = await client.query<OrphanRow>(selectSql, params);
    const orphanIds = rows.map((r) => r.id);

    console.log('=== FOB Type T shipment orphan cleanup ===\n');
    console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
    console.log(`Scope: ${sto ?? 'ALL FOB Type T shipments'}`);
    console.log(`Candidates: ${rows.length} shipment row(s)\n`);

    if (rows.length > 0) {
      const preview = rows.slice(0, 25).map((r) => ({
        shipment_id: r.shipment_id,
        contract_id: r.contract_id,
        sto_type: r.sto_type,
        status: r.status,
      }));
      console.log(JSON.stringify(preview, null, 2));
      if (rows.length > 25) {
        console.log(`... and ${rows.length - 25} more`);
      }
    }

    if (orphanIds.length === 0) {
      console.log('\nNothing to clean.');
      await client.query('COMMIT');
      return;
    }

    const vlpCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM vessel_loading_ports WHERE shipment_id = ANY($1::uuid[])`,
      [orphanIds],
    );
    const truckingCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM trucking_operations WHERE shipment_id = ANY($1::uuid[])`,
      [orphanIds],
    );

    console.log('\nRelated rows:');
    console.log(`  vessel_loading_ports: ${vlpCount.rows[0]?.c ?? '0'}`);
    console.log(`  trucking_operations:  ${truckingCount.rows[0]?.c ?? '0'}`);

    if (dryRun) {
      console.log('\nDry-run: no changes applied.');
      await client.query('ROLLBACK');
      return;
    }

    const delVlp = await client.query(
      `DELETE FROM vessel_loading_ports WHERE shipment_id = ANY($1::uuid[])`,
      [orphanIds],
    );
    const delTruck = await client.query(
      `DELETE FROM trucking_operations WHERE shipment_id = ANY($1::uuid[])`,
      [orphanIds],
    );
    const delShip = await client.query(`DELETE FROM shipments WHERE id = ANY($1::uuid[])`, [
      orphanIds,
    ]);

    await client.query('COMMIT');

    logger.info('cleanFobTypeTShipmentOrphans completed', {
      shipments: delShip.rowCount ?? 0,
      vessel_loading_ports: delVlp.rowCount ?? 0,
      trucking_operations: delTruck.rowCount ?? 0,
    });

    console.log('\nDeleted:');
    console.log(`  shipments: ${delShip.rowCount ?? 0}`);
    console.log(`  vessel_loading_ports: ${delVlp.rowCount ?? 0}`);
    console.log(`  trucking_operations: ${delTruck.rowCount ?? 0}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
