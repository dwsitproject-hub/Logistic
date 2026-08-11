/**
 * Diagnose Shipments > Vessel Idle count (busy vs idle breakdown).
 *
 * Run: npx ts-node src/scripts/diagVesselIdle.ts
 * Docker: docker exec klip-backend node dist/scripts/diagVesselIdle.js
 */
import { query } from '../database/connection';
import { loadVesselIdleList } from '../services/vesselIdle.service';
import { shippingPerfStoMetricsKeyExpr } from '../utils/shippingPerformanceStoSql';
import { sqlVesselCanonicalShipmentMatch } from '../utils/masterVesselCanonicalSql';
import {
  sqlIsContractSapClosedForStoExpr,
} from '../utils/contractDeliveryStatus';

function shipmentTableHasAnyEtaExpr(alias: string): string {
  const f = alias;
  return `(
    ${f}.eta_arrival IS NOT NULL OR ${f}.eta_berthed IS NOT NULL OR ${f}.eta_loading_start IS NOT NULL OR ${f}.eta_loading_complete IS NOT NULL OR ${f}.eta_sailed IS NOT NULL
    OR ${f}.eta_discharge_arrival IS NOT NULL OR ${f}.eta_discharge_berthed IS NOT NULL OR ${f}.eta_discharge_start IS NOT NULL OR ${f}.eta_discharge_complete IS NOT NULL
  )`;
}

function sqlShipmentRowEffectiveStatusExpr(alias: string, contractAlias = 'c'): string {
  const s = alias;
  const stoKey = shippingPerfStoMetricsKeyExpr(contractAlias, s);
  return `(
    CASE
      WHEN UPPER(TRIM(COALESCE(${s}.status, ''))) = 'CANCELLED' THEN 'CANCELLED'
      WHEN ${sqlIsContractSapClosedForStoExpr(contractAlias, stoKey)} THEN 'COMPLETED'
      WHEN ${s}.ata_discharge_complete IS NOT NULL THEN 'COMPLETED'
      WHEN ${s}.ata_discharge_start IS NOT NULL THEN 'UNLOADING'
      WHEN ${s}.ata_discharge_berthed IS NOT NULL THEN 'BERTHED_DP'
      WHEN ${s}.ata_discharge_arrival IS NOT NULL THEN 'ARRIVED_DP'
      WHEN ${s}.ata_sailed IS NOT NULL THEN 'SAILED'
      WHEN ${s}.ata_loading_complete IS NOT NULL THEN 'COMPLETED_LOADING'
      WHEN ${s}.ata_loading_start IS NOT NULL THEN 'LOADING'
      WHEN ${s}.ata_berthed IS NOT NULL THEN 'BERTHED_LP'
      WHEN ${s}.ata_arrival IS NOT NULL THEN 'ARRIVED_LP'
      WHEN ${shipmentTableHasAnyEtaExpr(s)} THEN 'PLANNED'
      ELSE 'UNPLANNED'
    END
  )`;
}

async function checkMigration136(): Promise<boolean> {
  const col = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'master_vessels' AND column_name = 'normalized_vessel_name'
     LIMIT 1`,
  );
  const aliasTable = await query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_name = 'master_vessel_code_aliases'
     LIMIT 1`,
  );
  return col.rows.length > 0 && aliasTable.rows.length > 0;
}

async function countBusyIdleBreakdown(): Promise<{
  tcMaster: number;
  busyNames: number;
  idleNames: number;
}> {
  const vesselMatch = sqlVesselCanonicalShipmentMatch('mv', 's');
  const stoKey = shippingPerfStoMetricsKeyExpr('c', 's');
  const hasSapSto = `${stoKey} IS NOT NULL`;
  const isPlanned = `${sqlShipmentRowEffectiveStatusExpr('s', 'c')} = 'PLANNED'`;
  const isOngoing = `${sqlShipmentRowEffectiveStatusExpr('s', 'c')} IN (
    'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING',
    'SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING'
  )`;
  const activeEngagement = `(
    UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
    AND NOT (${sqlIsContractSapClosedForStoExpr('c', stoKey)})
    AND s.ata_discharge_complete IS NULL
  )`;

  const sql = `
    WITH busy_canonical_names AS (
      SELECT DISTINCT mv.normalized_vessel_name
      FROM master_vessels mv
      INNER JOIN shipments s ON ${vesselMatch}
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE mv.normalized_vessel_name IS NOT NULL
        AND trim(mv.normalized_vessel_name) <> ''
        AND ${activeEngagement}
        AND (${hasSapSto} OR ${isPlanned} OR ${isOngoing})
    ),
    tc_master AS (
      SELECT count(*)::int AS c
      FROM master_vessels mv
      WHERE UPPER(TRIM(COALESCE(mv.terms, ''))) = 'T/C'
        AND mv.normalized_vessel_name IS NOT NULL
        AND trim(mv.normalized_vessel_name) <> ''
    ),
    busy AS (
      SELECT count(*)::int AS c FROM busy_canonical_names
    ),
    idle AS (
      SELECT count(DISTINCT mv.normalized_vessel_name)::int AS c
      FROM master_vessels mv
      WHERE mv.normalized_vessel_name IS NOT NULL
        AND trim(mv.normalized_vessel_name) <> ''
        AND UPPER(TRIM(COALESCE(mv.terms, ''))) = 'T/C'
        AND NOT EXISTS (
          SELECT 1 FROM busy_canonical_names b
          WHERE b.normalized_vessel_name = mv.normalized_vessel_name
        )
    )
    SELECT
      (SELECT c FROM tc_master) AS tc_master,
      (SELECT c FROM busy) AS busy_names,
      (SELECT c FROM idle) AS idle_names`;

  const res = await query(sql);
  const row = res.rows[0] as { tc_master: number; busy_names: number; idle_names: number };
  return {
    tcMaster: Number(row.tc_master ?? 0),
    busyNames: Number(row.busy_names ?? 0),
    idleNames: Number(row.idle_names ?? 0),
  };
}

async function main(): Promise<void> {
  console.log('=== Vessel Idle diagnostic ===\n');

  const migrationOk = await checkMigration136();
  console.log(`Migration 136 (normalized_vessel_name + aliases): ${migrationOk ? 'OK' : 'MISSING'}`);

  if (!migrationOk) {
    console.log('\nApply migration 136 before vessel idle canonical logic can run.');
    process.exit(1);
  }

  const breakdown = await countBusyIdleBreakdown();
  console.log(`T/C master vessels (distinct normalized name): ${breakdown.tcMaster}`);
  console.log(`Busy canonical names: ${breakdown.busyNames}`);
  console.log(`Idle canonical names (pre-port-usage): ${breakdown.idleNames}`);

  if (breakdown.tcMaster > 0 && breakdown.idleNames === 0 && breakdown.busyNames >= breakdown.tcMaster) {
    console.log('\nDiagnosis: OVER-BUSY — nearly all T/C vessels marked busy.');
  } else if (breakdown.idleNames > 0) {
    console.log('\nDiagnosis: idle pool non-empty at SQL layer.');
  }

  try {
    const api = await loadVesselIdleList();
    console.log(`\nloadVesselIdleList(): count=${api.count}, willFreeCount=${api.willFreeCount}`);
    if (api.count > 0) {
      console.log('Sample idle vessel:', api.vessels[0]?.vessel_name);
    }
  } catch (err) {
    console.error('\nloadVesselIdleList FAILED:', err);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
