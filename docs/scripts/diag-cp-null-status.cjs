/**
 * READ-ONLY. Contract Performance > view table: why are Shipment Status / Trucking Status empty?
 *
 * The two columns come from sqlRepresentativeShipmentStatusExpr / sqlRepresentativeTruckingStatusExpr, which read only the shipments /
 * trucking_operations rows whose contract_id is THAT contract's own uuid. Empty is correct when the contract has no such row (a LAND
 * contract has no shipment). It is wrong when the rows exist under another contract - a B2B origin keeps its STOs on its children, which
 * is why Contract Details lists them through CONTRACT_STO_SCOPE_IDS_SQL and the table does not.
 *
 * This counts, per transport mode, the contracts the table leaves empty and, for each, whether the detail modal's scope DOES hold
 * shipments / trucking. Needs no deploy: it calls the code ALREADY inside the running backend image (dist/).
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-null-status.cjs \
 *     | docker exec -i klip-backend node - [--from=2026-01-01] [--contract=1004031065]
 *
 * Nothing is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

(async () => {
  const from = arg('from', `${new Date().getFullYear()}-01-01`);
  const only = arg('contract', null);
  const pool = dist('database/connection').default;
  const { sqlRepresentativeShipmentStatusExpr, sqlRepresentativeTruckingStatusExpr } = dist('utils/contractPlanningStatusSql');
  const { CONTRACT_STO_SCOPE_IDS_SQL } = dist('utils/contractLogisticsStoDetailSql');
  try {
    const rows = (
      await pool.query(
        `SELECT c.contract_id,
                (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
                MAX(c.transport_mode) AS transport_mode,
                MAX(c.incoterm) AS incoterm,
                MAX(c.status) AS status,
                MAX(${sqlRepresentativeShipmentStatusExpr('c')}) AS shipment_status,
                MAX(${sqlRepresentativeTruckingStatusExpr('c')}) AS trucking_status
         FROM contracts c
         WHERE c.contract_date >= $1::date
           AND ($2::text IS NULL OR c.contract_id = $2)
         GROUP BY c.contract_id`,
        [from, only],
      )
    ).rows;
    console.log(`Contracts in the table since ${from}: ${rows.length}`);

    const tally = {};
    const bump = (mode, key) => {
      tally[mode] = tally[mode] || {};
      tally[mode][key] = (tally[mode][key] || 0) + 1;
    };
    const examples = [];
    for (const r of rows) {
      const mode = String(r.transport_mode || '(blank)').toUpperCase();
      const shipEmpty = !r.shipment_status;
      const truckEmpty = !r.trucking_status;
      bump(mode, 'total');
      if (shipEmpty) bump(mode, 'shipment status empty');
      if (truckEmpty) bump(mode, 'trucking status empty');
      if (!shipEmpty && !truckEmpty) continue;
      const scope = (
        await pool.query(
          `SELECT (SELECT COUNT(*) FROM shipments WHERE contract_id IN (${CONTRACT_STO_SCOPE_IDS_SQL})) AS ship_in_scope,
                  (SELECT COUNT(*) FROM trucking_operations WHERE contract_id IN (${CONTRACT_STO_SCOPE_IDS_SQL})) AS truck_in_scope`,
          [r.id],
        )
      ).rows[0];
      const shipMissed = shipEmpty && Number(scope.ship_in_scope) > 0;
      const truckMissed = truckEmpty && Number(scope.truck_in_scope) > 0;
      if (shipMissed) bump(mode, 'shipment status empty BUT shipments exist in the detail scope  <== wrong');
      if (truckMissed) bump(mode, 'trucking status empty BUT trucking exists in the detail scope  <== wrong');
      if ((shipMissed || truckMissed) && examples.length < 15) {
        examples.push(`  ${r.contract_id}  ${mode}  ${r.incoterm}  status=${r.status}  shipments(scope)=${scope.ship_in_scope}  trucking(scope)=${scope.truck_in_scope}`);
      }
    }

    console.log('\nBy transport mode:');
    for (const [mode, counts] of Object.entries(tally)) {
      console.log(`  ${mode}`);
      for (const [key, n] of Object.entries(counts)) console.log(`     ${String(n).padStart(6)}  ${key}`);
    }
    if (examples.length > 0) {
      console.log('\nExamples the table leaves empty although the detail modal lists rows (first 15):');
      examples.forEach((line) => console.log(line));
    } else {
      console.log('\nNo contract is empty while the detail scope holds rows: the empty cells are real (no shipment / trucking row at all).');
    }
  } catch (error) {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
