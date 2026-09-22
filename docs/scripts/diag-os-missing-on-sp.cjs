/*
 * READ-ONLY: why does Shipping Performance value a contract at 0 when Contract Performance does not?
 *
 *   node /app/diag-os-missing-on-sp.cjs 1004031065 1004030359 1004030633 1004031047
 *
 * WHY. diag-os-per-contract.cjs says WHICH contracts disagree. When Shipping Performance reads 0
 * against a Contract Performance figure, there are four candidate reasons and they need different
 * fixes, so guessing between them has been expensive here. This prints all four side by side.
 *
 *   1. Region/Site. Contract Performance reads plant_site from contract_performance_snapshot;
 *      the Shipping Performance OS arm computes it LIVE. If the snapshot predates a SAP import the
 *      two disagree, and the live test drops a contract the snapshot still shows.
 *   2. The SAP-closed gate. sqlContractExecutionOutstandingKgExpr returns 0 for a contract whose
 *      own GR says Close, whatever Contract Performance's status column says.
 *   3. No active-stage row. Outstanding is placed on the row carrying the contract's furthest
 *      active stage; a contract whose merged STO row reads COMPLETED has no such row and its
 *      outstanding lands nowhere.
 *   4. No shipment and not backlog. Then neither arm of the page can see it.
 *
 * It runs one query per contract and touches no cache.
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
const { sqlContractExecutionOutstandingKgExpr } = load('utils/contractExecutionOutstandingSql');
const {
  sqlRegionSiteDisplayForContract,
  sqlContractHasResolvedRegionSiteExpr,
} = load('utils/regionSiteSql');
const { sqlIsContractSapClosedExpr } = load('utils/contractDeliveryStatus');
const { resolveContractsQtyMoveCte } = load('services/contractQtyMoveSnapshot.service');
const {
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} = load('utils/shipmentUnplannedHybridSql');
/*
 * The backlog arm is six clauses AND-ed together, and knowing it returned false says nothing about
 * WHICH one rejected the contract. Two candidates were eliminated by reading alone - the cancelled
 * shipment test and sqlContractHasNoRegisteredEtaExpr both already ignore cancelled shipments - so
 * the rest are evaluated individually here rather than guessed at.
 */
const { buildShipmentPageSeaIncotermScopeSql } = load('utils/shipmentIncotermScope');
const { sqlIsContractSapInactiveForShipmentBacklogExpr } = load('utils/contractDeliveryStatus');
const {
  shipmentPageExcludeB2bChildCond,
  sqlContractHasNoRegisteredEtaExpr,
} = load('utils/shipmentPagePipelineSql');
const {
  sqlContractSharesNumericStoWithActiveSeaShipmentExpr,
} = load('utils/seaStoSiblingSql');
const { sqlContractIsB2bOriginOfShippedChildExpr } = load('utils/shipmentB2bOriginSql');
const { runShippingPerformance } = load('services/shippingPerformance.service');
const {
  contractNumbersOf,
  osStageOf,
} = load('services/shippingPerfContractGrainOs.service');
const { isShipmentActiveStage } = load('utils/shipmentActiveStageRank');

const IDS = process.argv.slice(2).filter(Boolean);
if (IDS.length === 0) {
  console.error('usage: node diag-os-missing-on-sp.cjs <contract_id> [contract_id ...]');
  process.exit(1);
}
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

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

  const sql = `WITH ${qtyMoveCte},${LATEST_SPD_CTE}
    SELECT c.contract_id,
           c.product,
           c.incoterm,
           (${sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number')}) AS site_live,
           (${sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number')}) AS site_resolves_live,
           (SELECT cps.plant_site FROM contract_performance_snapshot cps
             WHERE cps.contract_id = c.contract_id) AS site_in_cp_snapshot,
           ${sqlIsContractSapClosedExpr('c')} AS sap_closed,
           (${sqlContractExecutionOutstandingKgExpr('c.contract_id')})::numeric AS execution_os_kg,
           (SELECT COUNT(*)::int FROM shipments s WHERE s.contract_id = c.id) AS shipments_total,
           (SELECT STRING_AGG(DISTINCT COALESCE(s.status, '(null)'), ', ')
              FROM shipments s WHERE s.contract_id = c.id) AS shipment_statuses,
           (${unplannedContractBacklogBaseWhereSql('c', 'l')}) AS is_unplanned_backlog,
           (${preplannedContractBacklogBaseWhereSql('c', 'l')}) AS is_preplanned_backlog,
           (${buildShipmentPageSeaIncotermScopeSql('c')}) AS bl_sea_incoterm,
           NOT (${sqlIsContractSapInactiveForShipmentBacklogExpr('c')}) AS bl_sap_active,
           (${shipmentPageExcludeB2bChildCond('l')}) AS bl_not_b2b_child,
           (${sqlContractHasNoRegisteredEtaExpr('c')}) AS bl_no_registered_eta,
           NOT (${sqlContractSharesNumericStoWithActiveSeaShipmentExpr('c.id')}) AS bl_no_active_sto_sibling,
           NOT (${sqlContractIsB2bOriginOfShippedChildExpr('c')}) AS bl_not_b2b_origin_shipped
    FROM contracts c
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    WHERE c.contract_id = ANY($1::text[])`;

  const rows = (await connection.query(sql, [IDS])).rows;

  /*
   * And the other half of the answer: does the page actually carry a row naming this contract, and
   * is that row at an active stage? `os_status` is computed during the STO merge in TypeScript, not
   * in SQL, so only the page's own entry point can answer it.
   */
  const spRows = (await runShippingPerformance(
    { query: { scope: 'ytd', dateFrom: `${new Date().getFullYear()}-01-01`, dateTo: new Date().toISOString().slice(0, 10) } },
    'rows',
  )).rows;
  const rowsByContract = new Map(IDS.map((id) => [id, []]));
  for (const row of spRows) {
    for (const cn of contractNumbersOf(row)) {
      if (rowsByContract.has(cn)) rowsByContract.get(cn).push(row);
    }
  }

  const CLAUSES = [
    ['sea incoterm', 'bl_sea_incoterm'],
    ['SAP active for backlog', 'bl_sap_active'],
    ['not a B2B child', 'bl_not_b2b_child'],
    ['no registered ETA', 'bl_no_registered_eta'],
    ['no active STO sibling', 'bl_no_active_sto_sibling'],
    ['not a B2B origin already shipped', 'bl_not_b2b_origin_shipped'],
  ];

  for (const r of rows) {
    console.log('');
    console.log(`${r.contract_id}   ${r.product || '(no product)'} / ${r.incoterm || '(no incoterm)'}`);
    console.log(`   Region/Site live          : ${r.site_live ?? '(null)'}   resolves=${r.site_resolves_live}`);
    console.log(`   Region/Site in CP snapshot: ${r.site_in_cp_snapshot ?? '(not in snapshot)'}`);
    console.log(`   SAP closed (own GR)       : ${r.sap_closed}`);
    console.log(`   execution OS              : ${mt(r.execution_os_kg)} MT`);
    console.log(`   shipments                 : ${r.shipments_total}  [${r.shipment_statuses || '-'}]`);
    console.log(`   backlog arms              : unplanned=${r.is_unplanned_backlog} preplanned=${r.is_preplanned_backlog}`);
    const failed = CLAUSES.filter(([, k]) => r[k] === false).map(([label]) => label);
    console.log(`   backlog clause rejecting  : ${failed.length ? failed.join(' | ') : '(none - rejected by the cancelled-shipment test or it is in backlog)'}`);

    const mine = rowsByContract.get(String(r.contract_id)) || [];
    console.log(`   rows on the page naming it: ${mine.length}`);
    for (const row of mine.slice(0, 4)) {
      const stage = osStageOf(row);
      console.log(`      sto=${row.sto_number ?? row.sto_key ?? '-'}  status=${row.status}  os_status=${row.os_status ?? '(none)'}  stage_used=${stage}  active=${isShipmentActiveStage(stage)}  agg=${mt(row.outstanding_qty_aggregate)} MT`);
    }

    const reasons = [];
    if (r.site_resolves_live === false) {
      reasons.push(
        r.site_in_cp_snapshot && String(r.site_in_cp_snapshot).toUpperCase() !== 'BLANK'
          ? 'Region/Site DISAGREES: blank live, a real site in the CP snapshot - the snapshot is stale or the two expressions differ'
          : 'Region/Site is blank on both sides, so Contract Performance should be dropping it too',
      );
    }
    if (r.sap_closed === true) reasons.push('the SAP-closed gate zeroes it, whatever the status column says');
    if (Number(r.execution_os_kg) === 0 && r.sap_closed !== true && r.site_resolves_live !== false) {
      reasons.push('execution OS is 0 for another reason - read the qty_move figures');
    }
    if (r.shipments_total === 0 && !r.is_unplanned_backlog && !r.is_preplanned_backlog) {
      reasons.push('no shipment AND no backlog arm claims it, so neither arm of the page can see it');
    }
    /*
     * The verdict reads the ROW evidence gathered above, not just the contract's own columns.
     * An earlier version concluded "lost to the active-stage rule" from `has outstanding AND has
     * shipments` alone, and printed that against contracts whose row was sitting right there at
     * ARRIVED_DP with the quantity already placed on it. A check that states a wrong cause is
     * worse than one that says nothing.
     */
    if (r.shipments_total > 0 && Number(r.execution_os_kg) > 0) {
      const active = mine.filter((row) => isShipmentActiveStage(osStageOf(row)));
      if (active.length === 0 && mine.length > 0) {
        reasons.push('rows exist but NONE is at an active stage - this is the active-stage rule: the merged STO row reads COMPLETED and the outstanding is placed nowhere');
      } else if (mine.length === 0) {
        reasons.push('it has outstanding and shipments, yet NO row on the page names it - the contract number is being lost before the OS is placed (scope, or the STO merge)');
      } else {
        reasons.push(`a row IS at an active stage and carries ${mt(active[0].outstanding_qty_aggregate)} MT - on THIS database the contract is counted, so whatever loses it elsewhere is data, not code`);
      }
    }
    console.log(`   => ${reasons.length ? reasons.join('\n      => ') : 'nothing here explains it - widen the check'}`);
  }

  const missing = IDS.filter((id) => !rows.some((r) => String(r.contract_id) === id));
  if (missing.length) console.log(`\nnot found in contracts: ${missing.join(', ')}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
