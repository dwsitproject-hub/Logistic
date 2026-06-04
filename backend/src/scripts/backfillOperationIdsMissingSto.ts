/**
 * Backfill shipments.operation_id and trucking_operations.operation_id using:
 *   SEA  -> OP-SEA-DDMMYYYYxxxx
 *   LAND -> OP-LAND-DDMMYYYYxxxx
 *
 * Eligibility (conservative — does not overwrite arbitrary non-empty operation_ids):
 * - operation_id IS NULL / blank / '-' / 'N/A'
 * - or legacy TRUCK-* (from old API default)
 *
 * Optional diagnostics (no DB updates):
 *   cd backend && npx ts-node src/scripts/backfillOperationIdsMissingSto.ts "10000030/LS/I/2026"
 */

import { query } from '../database/connection';
import logger from '../utils/logger';

const PLACEHOLDER_OP = `(
  TRIM(COALESCE(t.operation_id::text, '')) IN ('', '-', 'N/A', '—')
)`;

/** Trucking rows that still need a synthetic OP-LAND id. */
const TRUCKING_ELIGIBLE_SQL = `
  (
    t.operation_id IS NULL
    OR ${PLACEHOLDER_OP}
    OR t.operation_id::text ~ '^TRUCK-'
  )
`;

const PLACEHOLDER_OP_S = `(
  TRIM(COALESCE(s.operation_id::text, '')) IN ('', '-', 'N/A', '—')
)`;

const SHIPMENT_ELIGIBLE_SQL = `
  (
    s.operation_id IS NULL
    OR ${PLACEHOLDER_OP_S}
    OR s.operation_id::text ~ '^TRUCK-'
  )
`;

export async function debugContractExtNo(ext: string): Promise<void> {
  const e = ext.trim();
  logger.info(`Diagnostics for Contract Ext No: ${e}`);

  const contracts = await query(
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
      c.sto_number AS contract_sto_number,
      l.contract_ext_no AS spd_contract_ext_no
    FROM contracts c
    LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
    WHERE c.contract_id = $1
       OR TRIM(COALESCE(l.contract_ext_no, '')) = $1
    `,
    [e]
  );
  console.log('[contracts + ext no]', JSON.stringify(contracts.rows, null, 2));

  if (contracts.rows.length === 0) {
    const spdOnly = await query(
      `
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
      FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) = $1
      LIMIT 5
      `,
      [e]
    );
    console.log('[sap_processed_data rows with this ext no]', JSON.stringify(spdOnly.rows, null, 2));
  }

  const cu = contracts.rows[0]?.contract_uuid as string | undefined;
  if (cu) {
    const truck = await query(
      `
      SELECT t.id, t.operation_id, t.status, t.created_at, c.contract_id, c.sto_number
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE c.id = $1::uuid
      ORDER BY t.created_at DESC
      `,
      [cu]
    );
    console.log('[trucking_operations for contract]', JSON.stringify(truck.rows, null, 2));

    const ship = await query(
      `
      SELECT s.id, s.shipment_id, s.operation_id, s.status, s.created_at, c.contract_id
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE c.id = $1::uuid
      ORDER BY s.created_at DESC
      `,
      [cu]
    );
    console.log('[shipments for contract]', JSON.stringify(ship.rows, null, 2));
  }
}

async function backfillShipments(): Promise<number> {
  const result = await query(
    `
    WITH ranked AS (
      SELECT
        s.id,
        TO_CHAR(COALESCE(s.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY') AS dmy,
        ROW_NUMBER() OVER (
          PARTITION BY TO_CHAR(COALESCE(s.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY')
          ORDER BY COALESCE(s.created_at, CURRENT_TIMESTAMP) NULLS LAST, s.id
        ) AS rn
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE (${SHIPMENT_ELIGIBLE_SQL})
    )
    UPDATE shipments s
    SET
      operation_id = 'OP-SEA-' || r.dmy || (
        CASE
          WHEN r.rn < 10000 THEN LPAD(r.rn::text, 4, '0')
          ELSE r.rn::text
        END
      ),
      updated_at = CURRENT_TIMESTAMP
    FROM ranked r
    WHERE s.id = r.id
    `
  );
  return result.rowCount ?? 0;
}

async function backfillTrucking(): Promise<number> {
  const result = await query(
    `
    WITH ranked AS (
      SELECT
        t.id,
        TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY') AS dmy,
        ROW_NUMBER() OVER (
          PARTITION BY TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY')
          ORDER BY COALESCE(t.created_at, CURRENT_TIMESTAMP) NULLS LAST, t.id
        ) AS rn
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE (${TRUCKING_ELIGIBLE_SQL})
    )
    UPDATE trucking_operations t
    SET
      operation_id = 'OP-LAND-' || r.dmy || (
        CASE
          WHEN r.rn < 10000 THEN LPAD(r.rn::text, 4, '0')
          ELSE r.rn::text
        END
      ),
      updated_at = CURRENT_TIMESTAMP
    FROM ranked r
    WHERE t.id = r.id
    `
  );
  return result.rowCount ?? 0;
}

async function main() {
  const arg = process.argv[2];
  if (arg && arg.trim() && arg !== '--') {
    await debugContractExtNo(arg);
    logger.info('Diagnostics only. Run without arguments to apply backfill.');
    return;
  }

  const countShip = await query(
    `SELECT count(*)::int AS n FROM shipments s INNER JOIN contracts c ON c.id = s.contract_id WHERE (${SHIPMENT_ELIGIBLE_SQL})`
  );
  const countTruck = await query(
    `SELECT count(*)::int AS n FROM trucking_operations t INNER JOIN contracts c ON c.id = t.contract_id WHERE (${TRUCKING_ELIGIBLE_SQL})`
  );
  logger.info('Eligible rows before update', {
    shipments: countShip.rows[0]?.n,
    trucking: countTruck.rows[0]?.n,
  });

  logger.info('Backfill operation_id (null/blank/placeholder/TRUCK-*)');
  const ship = await backfillShipments();
  const truck = await backfillTrucking();
  logger.info('Backfill complete', { shipmentsUpdated: ship, truckingUpdated: truck });
  console.log(
    JSON.stringify(
      {
        success: true,
        eligibleBefore: {
          shipments: countShip.rows[0]?.n ?? 0,
          trucking: countTruck.rows[0]?.n ?? 0,
        },
        shipmentsUpdated: ship,
        truckingUpdated: truck,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export { backfillShipments, backfillTrucking, main as backfillOperationIdsMissingSto };
