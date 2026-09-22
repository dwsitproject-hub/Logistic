/*
 * READ-ONLY. What would the B2B merge fix move, and can it double count?
 *
 *   node /app/diag-b2b-os-exposure.cjs                 (whole database)
 *   node /app/diag-b2b-os-exposure.cjs CPO BONTANG     (one slice)
 *
 * WHY. Shipping Performance's STO merge preferred `sto_metrics.contract_numbers`, which is built
 * from `contracts` alone and knows nothing of the main query's B2B relabelling - so a kept child
 * row, rewritten to its ORIGIN's number, lost that number again at the merge and its outstanding
 * was never placed. 5,000 MT on the dev copy (origins 9194100034 and 9334100045).
 *
 * The fix unions both sources. The risk that creates is the one B2B has caused here before: a
 * child AND its origin valued together, doubling the quantity. This script measures that exposure
 * BEFORE the fix ships, against real data, without needing the fix to be deployed - it uses only
 * builders the running container already has.
 *
 * It runs ONE query, touches no cache, and starts no page refresh.
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
const { resolveContractsQtyMoveCte } = load('services/contractQtyMoveSnapshot.service');
const { sqlRegionSiteDisplayForContract } = load('utils/regionSiteSql');

const PRODUCT = (process.argv[2] || '').trim().toUpperCase();
const SITE = (process.argv[3] || '').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

const B2B_FAMILY_IDS = `
  SELECT o2.contract_id
  FROM contracts o2
  JOIN contract_latest_spd_snapshot l2
    ON NULLIF(TRIM(o2.po_number::text), '') = NULLIF(TRIM(l2.contract_reference_po_raw), '')
  WHERE UPPER(TRIM(COALESCE(l2.b2b_flag_raw, ''))) = 'B2B'
  UNION
  SELECT l3.contract_number
  FROM contract_latest_spd_snapshot l3
  WHERE UPPER(TRIM(COALESCE(l3.b2b_flag_raw, ''))) = 'B2B'
    AND NULLIF(TRIM(l3.contract_reference_po_raw), '') IS NOT NULL`;

(async () => {
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: B2B_FAMILY_IDS,
  });
  const osOrigin = sqlContractExecutionOutstandingKgExpr('p.origin');
  const osChild = sqlContractExecutionOutstandingKgExpr('p.child');
  const regionSite = sqlRegionSiteDisplayForContract('oc.contract_id', 'oc.po_number');

  const scope = [];
  const params = [];
  if (PRODUCT) {
    params.push(PRODUCT);
    scope.push(`AND UPPER(TRIM(COALESCE(oc.product, ''))) LIKE '%' || $${params.length} || '%'`);
  }
  if (SITE) {
    params.push(SITE);
    scope.push(`AND UPPER(TRIM(COALESCE((${regionSite}), ''))) = $${params.length}`);
  }

  const sql = `WITH ${qtyMoveCte},
    pairs AS (
      SELECT l.contract_number AS child, o.contract_id AS origin
      FROM contract_latest_spd_snapshot l
      JOIN contracts o
        ON NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(l.contract_reference_po_raw), '')
      WHERE UPPER(TRIM(COALESCE(l.b2b_flag_raw, ''))) = 'B2B'
        AND NULLIF(TRIM(l.contract_reference_po_raw), '') IS NOT NULL
    )
    SELECT p.child, p.origin, oc.product, oc.contract_date,
           (${regionSite}) AS region_site,
           (SELECT COUNT(*)::int FROM shipments s JOIN contracts cc ON cc.id = s.contract_id
             WHERE cc.contract_id = p.origin) AS origin_shipments,
           (SELECT COUNT(*)::int FROM shipments s JOIN contracts cc ON cc.id = s.contract_id
             WHERE cc.contract_id = p.child) AS child_shipments,
           (${osOrigin})::numeric AS origin_os_kg,
           (${osChild})::numeric  AS child_os_kg
    FROM pairs p
    JOIN contracts oc ON oc.contract_id = p.origin
    WHERE 1=1 ${scope.join(' ')}`;

  const rows = (await connection.query(sql, params)).rows;
  const num = (v) => Number(v) || 0;

  const bothPositive = rows.filter((r) => num(r.origin_os_kg) > 0 && num(r.child_os_kg) > 0);
  const originOnly = rows.filter((r) => num(r.origin_os_kg) > 0 && num(r.child_os_kg) <= 0);
  const childOnly = rows.filter((r) => num(r.origin_os_kg) <= 0 && num(r.child_os_kg) > 0);
  const riskyShape = rows.filter((r) => r.origin_shipments > 0);

  console.log(`scope: ${PRODUCT || 'all products'} / ${SITE || 'all sites'}`);
  console.log(`B2B child -> origin pairs                 : ${rows.length}`);
  console.log(`  origin has a shipment of its own        : ${riskyShape.length}`);
  console.log('');
  console.log(`pairs where ONLY the origin carries OS     : ${originOnly.length}   ${mt(originOnly.reduce((a, r) => a + num(r.origin_os_kg), 0))} MT`);
  console.log(`pairs where ONLY the child carries OS      : ${childOnly.length}   ${mt(childOnly.reduce((a, r) => a + num(r.child_os_kg), 0))} MT`);
  console.log(`pairs where BOTH carry OS  <- the exposure : ${bothPositive.length}   overlap ${mt(bothPositive.reduce((a, r) => a + Math.min(num(r.origin_os_kg), num(r.child_os_kg)), 0))} MT`);
  console.log('');
  console.log('THE GUARD keeps the ORIGIN and drops the child on every "BOTH" pair, so that overlap');
  console.log('is what it prevents - not what the fix would add. Anything above zero here is what');
  console.log('would have doubled without applyB2bParentPreference.');
  if (bothPositive.length > 0) {
    console.log('');
    console.log('child           origin          origin MT    child MT   product   region/site');
    for (const r of bothPositive.slice(0, 30)) {
      console.log(
        `${String(r.child).padEnd(15)} ${String(r.origin).padEnd(15)} ${mt(r.origin_os_kg).padStart(9)} ${mt(r.child_os_kg).padStart(11)}   ${String(r.product || '').padEnd(9)} ${r.region_site || ''}`,
      );
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
