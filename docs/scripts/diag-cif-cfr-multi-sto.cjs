/*
 * READ-ONLY: how big is the "one CIF / CFR PO, several STOs" case, and what would showing it as ONE Shipments row move?
 *
 *   cd /opt/klip && git show origin/<branch>:docs/scripts/diag-cif-cfr-multi-sto.cjs | docker exec -i klip-backend node -
 *
 * Run it BEFORE and AFTER the change and compare section 3 and 4. Writes nothing.
 *
 * WHY. A CIF / CFR PO usually carries several SAP STOs of Type T (trucking legs); today each STO is its own Shipments row. Merging them
 * changes the ROW grain. The Shipments OS cards are contract grain (sqlShipmentExecutionOsPerContractCtes: one entry per contract, at its
 * furthest active stage), so the OS total should not move; the row counts, Contract Qty and the stage a PO's OS lands in can.
 *
 * 1. shape of the data, from contract_stos (the real PO<->STO edges)
 * 2. the page's own grain: shipments grouped by shipmentListSeaStoKeyExpr, per CIF / CFR contract
 * 3. what merging does to the cards: rows, Contract Qty, and the stage OS lands in (furthest vs earliest sibling)
 * 4. the cases that need a decision: STOs shared by several POs, siblings at different stages
 *
 * SAY WHAT IT IS NOT: stage uses shipments.status, not the page's derived effective_status (ETA / ATA aware), so section 3's stage figures are
 * a close proxy, not the card. The card itself is read off the page. OS uses the page's own contract-global expression over the
 * contract_qty_move_snapshot, the same source the cards read.
 */
const path = require('path');
const fs = require('fs');

const DIST = [process.env.KLIP_DIST, '/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].filter(Boolean).find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const pool = load('database/connection').default;
const { shipmentListSeaStoKeyExpr } = load('utils/shipmentStoTypeSql');
const { sqlContractGlobalOutstandingExpr } = load('utils/contractGlobalOutstandingSql');
const { shipmentActiveStageRank } = load('utils/shipmentActiveStageRank');

const KEY = shipmentListSeaStoKeyExpr('c', 'l', 's');
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const CARD = { 2: 'Planned', 3: 'Loading', 4: 'Sailed', 5: 'Discharge' };
const card = (rank) => CARD[rank] || '(no active stage)';

(async () => {
  console.log('== 1. CIF / CFR contracts and their STOs (contract_stos)');
  const shape = await pool.query(`
    WITH c AS (
      SELECT id, upper(trim(incoterm)) inc FROM contracts
      WHERE coalesce(sap_presence, 'PRESENT') = 'PRESENT' AND upper(trim(incoterm)) IN ('CIF', 'CFR')
    ), n AS (
      SELECT contract_id, count(DISTINCT trim(sto_number)) stos,
             count(DISTINCT trim(sto_number)) FILTER (WHERE upper(trim(sto_type)) = 'T') t,
             count(DISTINCT trim(sto_number)) FILTER (WHERE upper(trim(sto_type)) = 'V') v
      FROM contract_stos WHERE nullif(trim(sto_number), '') IS NOT NULL GROUP BY 1
    )
    SELECT c.inc, count(*)::int contracts,
           count(*) FILTER (WHERE n.stos IS NULL)::int no_sto,
           count(*) FILTER (WHERE n.stos = 1)::int one_sto,
           count(*) FILTER (WHERE n.stos > 1)::int multi_sto,
           count(*) FILTER (WHERE n.stos > 1 AND n.t = n.stos)::int multi_all_t,
           count(*) FILTER (WHERE n.stos > 1 AND n.v > 0)::int multi_with_v,
           coalesce(max(n.stos), 0)::int max_stos
    FROM c LEFT JOIN n ON n.contract_id = c.id GROUP BY 1 ORDER BY 1`);
  console.table(shape.rows);

  const shared = await pool.query(`
    WITH c AS (SELECT id FROM contracts WHERE coalesce(sap_presence, 'PRESENT') = 'PRESENT' AND upper(trim(incoterm)) IN ('CIF', 'CFR')),
    e AS (SELECT DISTINCT cs.contract_id, trim(cs.sto_number) sto FROM contract_stos cs JOIN c ON c.id = cs.contract_id WHERE nullif(trim(cs.sto_number), '') IS NOT NULL),
    sh AS (SELECT sto FROM e GROUP BY 1 HAVING count(*) > 1),
    per AS (SELECT contract_id, count(*) stos FROM e GROUP BY 1)
    SELECT (SELECT count(DISTINCT sto) FROM e)::int stos,
           (SELECT count(*) FROM sh)::int stos_on_several_pos,
           (SELECT count(DISTINCT e.contract_id) FROM e JOIN sh ON sh.sto = e.sto)::int pos_touching_a_shared_sto,
           (SELECT count(DISTINCT e.contract_id) FROM e JOIN sh ON sh.sto = e.sto JOIN per ON per.contract_id = e.contract_id WHERE per.stos > 1)::int of_which_multi_sto`);
  console.log('shared STOs (one STO on more than one PO):');
  console.table(shared.rows);

  console.log('== 2. the page grain: shipments of CIF / CFR contracts, one row per list STO key');
  const rows = await pool.query(`
    SELECT c.id::text cid, c.contract_id, c.quantity_ordered qty, ${KEY} sto_key, upper(coalesce(s.status, '')) status
    FROM shipments s
    JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
    WHERE upper(trim(c.incoterm)) IN ('CIF', 'CFR') AND coalesce(c.sap_presence, 'PRESENT') = 'PRESENT'`);
  // one row per (contract, sto_key); a STO shared by two contracts is one page row, so count rows by sto_key
  const rowByKey = new Map();
  const byContract = new Map();
  for (const r of rows.rows) {
    const k = String(r.sto_key);
    if (!rowByKey.has(k)) rowByKey.set(k, { contracts: new Set(), statuses: new Set() });
    rowByKey.get(k).contracts.add(r.contract_id);
    rowByKey.get(k).statuses.add(r.status);
    if (!byContract.has(r.contract_id)) byContract.set(r.contract_id, { qty: Number(r.qty || 0), keys: new Set(), statuses: [] });
    const bc = byContract.get(r.contract_id);
    bc.keys.add(k);
    bc.statuses.push(r.status);
  }
  const multi = [...byContract.entries()].filter(([, v]) => v.keys.size > 1);
  const rowsOnMulti = new Set();
  for (const [, v] of multi) for (const k of v.keys) rowsOnMulti.add(k);
  console.log(
    `shipments ${rows.rows.length} | page rows (distinct STO keys) ${rowByKey.size} | contracts ${byContract.size} | ` +
      `contracts on 2+ rows ${multi.length} (${pct(multi.length, byContract.size)}) carrying ${rowsOnMulti.size} rows`,
  );

  console.log('== 3. what merging a PO\'s rows into one does to the cards');
  let qtyToday = 0;
  let qtyAfter = 0;
  for (const [, v] of multi) {
    qtyToday += v.qty * v.keys.size;
    qtyAfter += v.qty;
  }
  console.log(`rows on those contracts: ${rowsOnMulti.size} -> ${multi.length} (a row per PO); the other rows are untouched`);
  console.log(`card Contract Qty counted for them: ${mt(qtyToday)} MT today -> ${mt(qtyAfter)} MT after (today counts a PO once per STO row)`);

  if (multi.length > 0) {
    const ids = multi.map(([cn]) => cn);
    const os = await pool.query(
      `WITH qty_move AS (
         SELECT contract_number, quantity_delivery_trucking, quantity_delivery_vessel, quantity_receive, quantity_delivery
         FROM contract_qty_move_snapshot
       )
       SELECT c.contract_id, (${sqlContractGlobalOutstandingExpr({
         contractQtyExpr: 'COALESCE(c.quantity_ordered, 0)',
         incotermExpr: 'c.incoterm',
         contractNumberExpr: 'c.contract_id',
       })}) AS os
       FROM contracts c WHERE c.contract_id = ANY($1::text[])`,
      [ids],
    );
    const osBy = new Map(os.rows.map((r) => [r.contract_id, Number(r.os || 0)]));
    const furthestCard = {};
    const earliestCard = {};
    let osTotal = 0;
    let osMoves = 0;
    let posMoving = 0;
    for (const [cn, v] of multi) {
      const ranks = v.statuses.map((s) => shipmentActiveStageRank(s));
      const active = ranks.filter((r) => r > 1);
      const furthest = active.length ? Math.max(...active) : 1;
      const earliest = active.length ? Math.min(...active) : 1;
      const o = osBy.get(cn) || 0;
      osTotal += o;
      furthestCard[card(furthest)] = (furthestCard[card(furthest)] || 0) + o;
      earliestCard[card(earliest)] = (earliestCard[card(earliest)] || 0) + o;
      if (furthest !== earliest) {
        posMoving += 1;
        osMoves += o;
      }
    }
    console.log(`OS of those contracts (contract grain, what the cards sum): ${mt(osTotal)} MT`);
    console.log('by stage card, today\'s rule (furthest sibling wins):');
    console.table(Object.entries(furthestCard).map(([k, v]) => ({ card: k, os_mt: mt(v) })));
    console.log('by stage card IF the merged row took the EARLIEST sibling stage instead:');
    console.table(Object.entries(earliestCard).map(([k, v]) => ({ card: k, os_mt: mt(v) })));
    console.log(`POs whose siblings are at different active stages: ${posMoving} -> ${mt(osMoves)} MT of OS would change card under an earliest-stage rule`);
  }

  console.log('== 4. cases that need a decision');
  const sharedRows = [...rowByKey.entries()].filter(([, v]) => v.contracts.size > 1).length;
  console.log(`page rows that already carry several POs (a STO shared by POs): ${sharedRows}`);
  const mixed = multi.filter(([, v]) => new Set(v.statuses).size > 1).length;
  console.log(`multi-row POs whose rows have different statuses: ${mixed} of ${multi.length}`);

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
