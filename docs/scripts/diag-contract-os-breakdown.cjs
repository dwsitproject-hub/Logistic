/*
 * READ-ONLY: where does ONE contract's outstanding come from, arm by arm?
 *
 *   node /app/diag-contract-os-breakdown.cjs 1004030968 1004031128
 *
 * WHY. "Contract X shows the wrong OS" is the most common report on this system, and the answer is
 * always one of a small set: the quantities in qty_move, which arm claims the contract (execution
 * or backlog), or a gate that zeroes it. Guessing between them has been expensive; this prints all
 * of them side by side for the contracts named.
 *
 * Every figure comes from the pages' own builders - sqlContractGlobalOutstandingExpr,
 * sqlContractExecutionOutstandingKgExpr, sqlBacklogRemainingOsJoinExpr and the two backlog WHERE
 * clauses - so a number here is the number a page would use, not a reconstruction of it.
 *
 * READ IT LIKE THIS. The three OS figures normally agree. When they do not:
 *   global != execution   a per-contract gate fired - SAP closed, or the Region/Site does not
 *                         resolve (Contract Performance drops those, so the pages must too)
 *   backlog > 0 AND a shipment exists   the two arms are meant to be disjoint; both claiming it is
 *                         a fault, and the last one cost 5,836 MT before it was found
 *   OS == ordered         nothing has been delivered, which is ordinary for a new contract and is
 *                         NOT evidence of a fault on its own
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) =>
  fs.existsSync(p),
);
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

const connection = load('database/connection');
const { sqlContractGlobalOutstandingExpr } = load('utils/contractGlobalOutstandingSql');
const { sqlContractExecutionOutstandingKgExpr } = load('utils/contractExecutionOutstandingSql');
const { contractEffectiveIncotermExpr } = load('utils/truckingIncotermScope');
const {
  sqlBacklogRemainingOsJoinExpr,
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} = load('utils/shipmentUnplannedHybridSql');
const {
  sqlRegionSiteDisplayForContract,
  sqlContractHasResolvedRegionSiteExpr,
} = load('utils/regionSiteSql');
const { sqlIsContractSapClosedExpr } = load('utils/contractDeliveryStatus');
const { resolveContractsQtyMoveCte } = load('services/contractQtyMoveSnapshot.service');

const IDS = process.argv.slice(2).filter(Boolean);
if (IDS.length === 0) {
  console.error('usage: node diag-contract-os-breakdown.cjs <contract_id> [contract_id ...]');
  process.exit(1);
}
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 });

const LATEST_SPD_CTE =
  ` latest_spd_contract AS (
     SELECT contract_number, effective_sto, b2b_flag_raw, contract_reference_po_raw,
            contract_ext_no_raw, discharge_destination
     FROM contract_latest_spd_snapshot
     WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
   )`;

(async () => {
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT c_s.contract_id FROM contracts c_s WHERE c_s.contract_id = ANY($1::text[])',
  });
  const globalOs = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: contractEffectiveIncotermExpr('c'),
    contractNumberExpr: 'c.contract_id',
  });
  // Needs the alias `qm` - the builder joins qty_move by that name.
  const backlogOs = sqlBacklogRemainingOsJoinExpr();

  const rows = (
    await connection.query(
      `WITH ${qtyMoveCte},${LATEST_SPD_CTE}
       SELECT c.contract_id, c.product, c.incoterm, c.transport_mode, c.status,
              c.quantity_ordered AS ordered_kg,
              qm.quantity_receive AS receive_kg,
              qm.quantity_delivery AS delivery_kg,
              qm.quantity_delivery_vessel AS vessel_kg,
              qm.quantity_delivery_trucking AS trucking_kg,
              (${globalOs})::numeric AS global_os_kg,
              (${sqlContractExecutionOutstandingKgExpr('c.contract_id')})::numeric AS exec_os_kg,
              (${backlogOs})::numeric AS backlog_os_kg,
              (${unplannedContractBacklogBaseWhereSql('c', 'l')}) AS is_unplanned,
              (${preplannedContractBacklogBaseWhereSql('c', 'l')}) AS is_preplanned,
              ${sqlIsContractSapClosedExpr('c')} AS sap_closed,
              (${sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number')}) AS region_site,
              (${sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number')}) AS site_resolves,
              (SELECT COUNT(*)::int FROM shipments s WHERE s.contract_id = c.id) AS shipments,
              (SELECT STRING_AGG(DISTINCT COALESCE(s.status, '(null)'), ', ')
                 FROM shipments s WHERE s.contract_id = c.id) AS shipment_statuses
       FROM contracts c
       LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
       LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id
       WHERE c.contract_id = ANY($1::text[])
       ORDER BY c.contract_id`,
      [IDS],
    )
  ).rows;

  for (const r of rows) {
    const g = Number(r.global_os_kg) || 0;
    const e = Number(r.exec_os_kg) || 0;
    const b = Number(r.backlog_os_kg) || 0;
    console.log('');
    console.log(`${r.contract_id}   ${r.product || '-'} / ${r.incoterm || '-'} / ${r.transport_mode || '(no transport)'}   status=${r.status || '-'}`);
    console.log(`   ordered        : ${mt(r.ordered_kg)} MT`);
    console.log(`   qty_move       : receive ${mt(r.receive_kg)}  delivery ${mt(r.delivery_kg)}  (vessel ${mt(r.vessel_kg)}, trucking ${mt(r.trucking_kg)}) MT`);
    console.log(`   OS global      : ${mt(g)} MT`);
    console.log(`   OS execution   : ${mt(e)} MT`);
    console.log(`   OS backlog     : ${mt(b)} MT   (unplanned=${r.is_unplanned} preplanned=${r.is_preplanned})`);
    console.log(`   SAP closed     : ${r.sap_closed}`);
    console.log(`   Region/Site    : ${r.region_site ?? '(null)'}   resolves=${r.site_resolves}`);
    console.log(`   shipments      : ${r.shipments}  [${r.shipment_statuses || '-'}]`);

    const notes = [];
    if (Math.abs(g - e) > 1000) {
      notes.push('global and execution differ - a per-contract gate fired (SAP closed, or Region/Site does not resolve)');
    }
    if (b > 1000 && r.shipments > 0 && (r.is_unplanned || r.is_preplanned)) {
      notes.push('a backlog arm claims it AND it has shipments - the two arms are meant to be disjoint');
    }
    if (r.site_resolves === false) {
      notes.push('Region/Site does not resolve, so Contract Performance drops it and the other pages now do too');
    }
    if (g > 1000 && Math.abs(g - Number(r.ordered_kg)) < 1000) {
      notes.push('OS equals the ordered quantity: nothing delivered yet. Ordinary for a new contract, not a fault by itself');
    }
    console.log(`   => ${notes.length ? notes.join('\n      => ') : 'the three arms agree and no gate fired'}`);
  }

  const missing = IDS.filter((id) => !rows.some((r) => String(r.contract_id) === id));
  if (missing.length) console.log(`\nnot found in contracts: ${missing.join(', ')}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
