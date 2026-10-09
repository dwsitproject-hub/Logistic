/*
 * READ-ONLY: for a few named contracts, why does Contract Performance count outstanding that Shipping Performance does not list as On Going?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-sp-vs-cp-contract.cjs \
 *     | docker exec -i klip-backend node - --contract=1004030297,1004030835,1014003256
 *
 * Built for the three contracts diag-invariant2-gap.cjs left in class B (CP Open with outstanding, SP lists them only as Completed). For each
 * contract it prints, side by side:
 *
 *   CP   the Contract Performance row: import_status, status, outstanding, delivery/receive, STO count, "all STOs discharged", last ATC
 *   SP   every Shipping Performance row for the contract: status, os_status, backlog flag, the outstanding fields, import_status
 *   DB   the shipments (stored status, ATC, delivered qty) and their ports' ATC
 *   GATE whether the contract passes the two backlog gates (the arm that lists a contract with no running shipment), and its remaining OS
 *
 * SP derives a shipment's status from the ATA ladder and the contract's import status (deriveShipmentStatus): a discharge ATC or a closed
 * import makes it COMPLETED however the stored status reads. CP says Open while outstanding is positive and not every STO has discharged.
 * Whichever side of that this prints is the cause. Costs one Shipping Performance pass (~70s). Nothing is written.
 */
const path = require('path');
const fs = require('fs');

const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

const connection = load('database/connection');
const { runShippingPerformance, invalidateShippingPerformanceRowCache } = load('services/shippingPerformance.service');
const { parseLatePerformanceFilters, loadLatePerformanceRows, rowMatchesContractPerfStatusFilter } = load('services/latePerformance.service');
const {
  sqlBacklogRemainingOsJoinExpr,
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} = load('utils/shipmentUnplannedHybridSql');
const { shippingPerfOutstandingQtyKgForAggregate } = load('utils/shippingPerformanceOutstandingAgg');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const TARGETS = String(arg('contract') || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
if (TARGETS.length === 0) {
  console.error('Give --contract=<number>[,<number>...].');
  process.exit(1);
}
const DATE_FROM = arg('from') || new Date().getFullYear() + '-01-01';
const DATE_TO = arg('to') || new Date().toISOString().slice(0, 10);

const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');
const contractsOf = (row) =>
  String(row.contract_number ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const LATEST_SPD_CTE =
  ' latest_spd_contract AS (' +
  '   SELECT contract_number, effective_sto, b2b_flag_raw, contract_reference_po_raw,' +
  '          contract_ext_no_raw, discharge_destination' +
  '   FROM contract_latest_spd_snapshot' +
  "   WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''" +
  ' )';

(async () => {
  console.log('contracts: ' + TARGETS.join(', ') + '   scope ' + DATE_FROM + '..' + DATE_TO);

  invalidateShippingPerformanceRowCache();
  const sp = await runShippingPerformance({ query: { scope: 'ytd', dateFrom: DATE_FROM, dateTo: DATE_TO } }, 'rows');
  const cpFilters = parseLatePerformanceFilters({ query: { dateFrom: DATE_FROM, dateTo: DATE_TO } }, 'rows');
  const cpAll = await loadLatePerformanceRows(cpFilters);

  for (const c of TARGETS) {
    console.log('\n' + '='.repeat(100));
    console.log('CONTRACT ' + c);

    const cp = cpAll.find((r) => String(r.contract_id) === c);
    console.log('\n[CP] Contract Performance row');
    if (!cp) console.log('  not in the Contract Performance row set for this period');
    else {
      console.log('  Open per the page: ' + rowMatchesContractPerfStatusFilter(cp, 'Open') + '   import_status=' + (cp.import_status ?? '-') + '   status=' + (cp.status ?? '-'));
      console.log('  incoterm=' + cp.incoterm + '   plant_site=' + cp.plant_site + '   product=' + cp.product);
      console.log('  contract qty=' + mt(cp.quantity_ordered) + ' MT   delivery=' + mt(cp.quantity_delivery) + '   receive=' + mt(cp.quantity_receive) + '   OUTSTANDING=' + mt(cp.outstanding_quantity) + ' MT');
      console.log('  sto_count=' + cp.sto_count + '   all_stos_discharged=' + cp.all_stos_discharged + '   last ATC=' + day(cp.last_ata_vessel_complete_discharge) + '   last ETC=' + day(cp.last_eta_vessel_complete_discharge));
    }

    console.log('\n[SP] Shipping Performance rows');
    const rows = sp.rows.filter((r) => contractsOf(r).includes(c));
    if (rows.length === 0) console.log('  none');
    for (const r of rows) {
      console.log(
        '  sto=' + (r.sto_number || r.sto_key || '-') + '  contracts=' + r.contract_number +
          '\n     status=' + r.status + '  os_status=' + (r.os_status ?? '-') + '  backlog=' + (r.is_unplanned_backlog === true) + '  import_status=' + (r.import_status ?? '-') +
          '\n     outstanding(aggregate)=' + mt(shippingPerfOutstandingQtyKgForAggregate(r)) + ' MT  actual=' + mt(r.outstanding_qty_actual) + '  qty=' + mt(r.outstanding_qty) + '  po_sto_count=' + (r.po_sto_count ?? '-') +
          '\n     ATC=' + day(r.discharge_ata_completed) + '  ETC=' + day(r.discharge_eta_completed) + '  delivered=' + mt(r.delivered_qty) + '  klip delivered=' + mt(r.quantity_delivered_klip),
      );
    }

    console.log('\n[DB] shipments and their ports');
    const ships = (
      await connection.query(
        'SELECT s.* FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE c.contract_id = $1 ORDER BY s.updated_at DESC LIMIT 20',
        [c],
      )
    ).rows;
    if (ships.length === 0) console.log('  none');
    for (const s of ships) {
      const ports = (
        await connection.query(
          'SELECT is_discharge_port, ata_loading_completed, eta_vessel_complete_discharge FROM vessel_loading_ports WHERE shipment_id = $1 ORDER BY is_discharge_port DESC',
          [s.id],
        )
      ).rows;
      console.log(
        '  ' + (s.operation_id || s.id) + '  stored status=' + s.status + '  ATC(shipment)=' + day(s.ata_discharge_complete) + '  ETC(shipment)=' + day(s.eta_discharge_complete) +
          '  delivered=' + mt(s.quantity_delivered) + '  klip delivered=' + mt(s.quantity_delivered_klip) + '  updated=' + day(s.updated_at),
      );
      ports.forEach((p) =>
        console.log('       port discharge=' + p.is_discharge_port + '  ATA completed (the discharge port keeps its ATC here)=' + day(p.ata_loading_completed) + '  ETC=' + day(p.eta_vessel_complete_discharge)),
      );
    }

    console.log('\n[GATE] the backlog arm (lists a contract with remaining OS and no running shipment)');
    const osExpr = sqlBacklogRemainingOsJoinExpr();
    const gate = async (label, whereSql) => {
      const r = await connection.query(
        'WITH ' + LATEST_SPD_CTE +
          ' SELECT (' + osExpr + ')::numeric AS os_kg' +
          ' FROM contracts c' +
          ' LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id' +
          ' LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id' +
          ' WHERE c.contract_id = $1 AND (' + whereSql + ')',
        [c],
      );
      console.log('  ' + label.padEnd(12) + (r.rows.length > 0 ? 'PASSES   remaining OS ' + mt(r.rows[0].os_kg) + ' MT' : 'does not pass the gate'));
    };
    await gate('Unplanned', unplannedContractBacklogBaseWhereSql('c', 'l'));
    await gate('Preplanned', preplannedContractBacklogBaseWhereSql('c', 'l'));
    const raw = await connection.query(
      'WITH ' + LATEST_SPD_CTE +
        ' SELECT (' + osExpr + ')::numeric AS os_kg FROM contracts c' +
        ' LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id' +
        ' LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id' +
        ' WHERE c.contract_id = $1',
      [c],
    );
    console.log('  remaining OS by that expression, gates ignored: ' + (raw.rows[0] ? mt(raw.rows[0].os_kg) + ' MT' : '-'));
  }

  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message ? e.message : e);
  process.exit(1);
});
