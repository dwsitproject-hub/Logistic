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
           (${preplannedContractBacklogBaseWhereSql('c', 'l')}) AS is_preplanned_backlog
    FROM contracts c
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    WHERE c.contract_id = ANY($1::text[])`;

  const rows = (await connection.query(sql, [IDS])).rows;

  for (const r of rows) {
    console.log('');
    console.log(`${r.contract_id}   ${r.product || '(no product)'} / ${r.incoterm || '(no incoterm)'}`);
    console.log(`   Region/Site live          : ${r.site_live ?? '(null)'}   resolves=${r.site_resolves_live}`);
    console.log(`   Region/Site in CP snapshot: ${r.site_in_cp_snapshot ?? '(not in snapshot)'}`);
    console.log(`   SAP closed (own GR)       : ${r.sap_closed}`);
    console.log(`   execution OS              : ${mt(r.execution_os_kg)} MT`);
    console.log(`   shipments                 : ${r.shipments_total}  [${r.shipment_statuses || '-'}]`);
    console.log(`   backlog arms              : unplanned=${r.is_unplanned_backlog} preplanned=${r.is_preplanned_backlog}`);

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
    if (r.shipments_total > 0 && Number(r.execution_os_kg) > 0) {
      reasons.push('it HAS outstanding and HAS shipments - so the loss is the active-stage rule: no row carries its furthest active stage (the merged STO row probably reads COMPLETED)');
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
