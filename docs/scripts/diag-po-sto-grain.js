/*
 * READ-ONLY: lay out one PO / STO across every grain it lives at, so a quantity that looks wrong
 * can be traced to the grain it was summed at rather than guessed about.
 *
 *   node /app/diag-po-sto-grain.js 1001028289
 *   node /app/diag-po-sto-grain.js 1016010373      (an STO number works too)
 *
 * Written for a Shipments row showing Contract Qty 2,000 MT, Delivery 2,001 MT and Received
 * 4,001 MT on one STO carrying five POs, and for the same contract's Table List STO coming back
 * empty. Both are grain questions: sto_metrics sums receive_kg per STO KEY across every PO on it
 * (SUM(po.receive_kg)), while the contract column beside it is one contract's own figure.
 *
 * This prints raw table facts only - no app expressions - because the point is to see what the
 * inputs actually are before deciding which expression is misreading them.
 */
const connection = require('/app/dist/database/connection');

const ARG = (process.argv[2] || '').trim();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 });

(async () => {
  if (!ARG) {
    console.log('usage: node /app/diag-po-sto-grain.js <PO number | STO number>');
    process.exit(1);
  }

  // 1. Which contracts carry this number, either as their PO or through a shipment's STO.
  const contracts = (await connection.query(`
    SELECT DISTINCT c.id, c.contract_id, c.po_number, c.sto_number, c.incoterm,
           c.transport_mode,
           ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 2) AS ordered_mt,
           snap.b2b_flag_raw AS b2b_flag,
           snap.contract_reference_po_raw AS contract_reference_po
    FROM contracts c
    LEFT JOIN shipments s ON s.contract_id = c.id
    -- b2b_flag and contract_reference_po are NOT columns on contracts. Migration 161 put them on
    -- contract_latest_spd_snapshot, keyed by contract_number - which is what the first run of this
    -- script found out the expensive way, with 42703 after copying the column names out of the
    -- migration without reading which table it altered.
    LEFT JOIN contract_latest_spd_snapshot snap ON snap.contract_number = c.contract_id
    WHERE TRIM(COALESCE(c.po_number::text, '')) = $1
       OR TRIM(COALESCE(c.sto_number::text, '')) = $1
       OR TRIM(COALESCE(snap.contract_reference_po_raw::text, '')) = $1
       OR TRIM(COALESCE(s.shipment_id::text, '')) = $1
    ORDER BY c.contract_id`, [ARG])).rows;

  console.log(`\nA. contracts touching "${ARG}" (${contracts.length}):`);
  for (const c of contracts) {
    console.log(`   ${c.contract_id}  PO ${c.po_number || '-'}  STO ${c.sto_number || '-'}  ${c.incoterm || '-'}` +
      `  ${c.transport_mode || '-'}  b2b=${c.b2b_flag || '-'}  ordered ${c.ordered_mt} MT` +
      `  reff_po ${c.contract_reference_po || '-'}`);
  }
  if (!contracts.length) {
    console.log('   (nothing - check the number)');
    process.exit(0);
  }

  const ids = contracts.map((c) => c.id);

  // 2. Shipments on those contracts, and every OTHER contract sharing the same STO. The second
  //    part is the one that matters: sums keyed by STO reach across contracts.
  const ships = (await connection.query(`
    SELECT s.id, c.contract_id, c.po_number, s.shipment_id AS sto, s.vessel_name, s.status,
           ROUND(COALESCE(s.quantity_delivered_klip, 0) / 1000, 2) AS klip_delivery_mt,
           ROUND(COALESCE(s.actual_vessel_qty_receive, 0) / 1000, 2) AS klip_receive_mt
    FROM shipments s
    JOIN contracts c ON c.id = s.contract_id
    WHERE s.contract_id = ANY($1::uuid[])
    ORDER BY c.contract_id, s.shipment_id`, [ids])).rows;
  console.log(`\nB. shipments on those contracts (${ships.length}):`);
  for (const s of ships) {
    console.log(`   ${s.contract_id}  PO ${s.po_number || '-'}  STO ${s.sto || '-'}  ${s.vessel_name || '-'}` +
      `  ${s.status || '-'}  KLIP del ${s.klip_delivery_mt} / rec ${s.klip_receive_mt} MT`);
  }

  const stos = [...new Set(ships.map((s) => String(s.sto || '').trim()).filter(Boolean))];
  if (stos.length) {
    const shared = (await connection.query(`
      SELECT TRIM(s.shipment_id::text) AS sto, c.contract_id, c.po_number, c.incoterm,
             ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 2) AS ordered_mt, s.status
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      WHERE TRIM(s.shipment_id::text) = ANY($1::text[])
      ORDER BY sto, c.contract_id`, [stos])).rows;
    console.log(`\nC. EVERY contract sharing those STOs - anything summed by STO key spans all of these:`);
    let lastSto = null;
    let running = 0;
    for (const r of shared) {
      if (r.sto !== lastSto) {
        if (lastSto !== null) console.log(`      -> contract qty summed across this STO: ${mt(running * 1000)} MT`);
        console.log(`   STO ${r.sto}:`);
        lastSto = r.sto;
        running = 0;
      }
      running += Number(r.ordered_mt || 0);
      console.log(`      ${r.contract_id}  PO ${r.po_number || '-'}  ${r.incoterm || '-'}  ordered ${r.ordered_mt} MT  ${r.status || '-'}`);
    }
    if (lastSto !== null) console.log(`      -> contract qty summed across this STO: ${mt(running * 1000)} MT`);
  }

  // 3. SAP rows for these contracts: the delivery / receive figures the sums are built from.
  const sap = (await connection.query(`
    SELECT c.contract_id, spd.po_number, spd.sto_number,
           -- SAP raw values are text and may carry thousands separators. A bare ::numeric turns a
           -- read-only diagnostic into an error on the first row that has one, so strip and guard.
           NULLIF(REGEXP_REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivery', ''), '[^0-9.-]', '', 'g'), '') AS sap_delivery,
           NULLIF(REGEXP_REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', ''), '[^0-9.-]', '', 'g'), '')  AS sap_receive,
           NULLIF(TRIM(spd.data->'raw'->>'GR PO Status'), '')  AS gr_po,
           NULLIF(TRIM(spd.data->'raw'->>'GR STO Status'), '') AS gr_sto
    FROM sap_processed_data spd
    JOIN contracts c ON c.contract_id = spd.contract_number
    WHERE c.id = ANY($1::uuid[])
    ORDER BY c.contract_id, spd.po_number, spd.sto_number`, [ids])).rows;
  console.log(`\nD. SAP rows behind them (${sap.length}):`);
  for (const r of sap) {
    console.log(`   ${r.contract_id}  PO ${r.po_number || '-'}  STO ${r.sto_number || '-'}` +
      `  delivery ${r.sap_delivery ?? '-'}  receive ${r.sap_receive ?? '-'}` +
      `  GR PO ${r.gr_po || '-'}  GR STO ${r.gr_sto || '-'}`);
  }

  // 4. Why Table List STO can come back empty: it enumerates contract_stos UNION the SAP STO
  //    numbers. A contract whose STOs live on a B2B child has neither under its own number.
  const cstos = (await connection.query(`
    SELECT c.contract_id, cs.sto_number
    FROM contract_stos cs
    JOIN contracts c ON c.id = cs.contract_id
    WHERE cs.contract_id = ANY($1::uuid[])
    ORDER BY c.contract_id, cs.sto_number`, [ids])).rows;
  console.log(`\nE. contract_stos rows (${cstos.length}) - Table List STO enumerates these plus SAP STO numbers:`);
  if (!cstos.length) console.log('   (none - so the table has nothing to list under this contract number)');
  for (const r of cstos) console.log(`   ${r.contract_id}  STO ${r.sto_number}`);

  const sapStoCount = sap.filter((r) => r.sto_number).length;
  console.log(`   SAP rows carrying an STO number: ${sapStoCount}`);

  // 5. B2B: the children that point at this contract's PO, whose quantities roll up to it.
  const children = (await connection.query(`
    SELECT c.contract_id, c.po_number, snap.contract_reference_po_raw AS contract_reference_po, c.incoterm,
           ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 2) AS ordered_mt
    FROM contracts c
    JOIN contract_latest_spd_snapshot snap ON snap.contract_number = c.contract_id
    WHERE TRIM(COALESCE(snap.contract_reference_po_raw::text, '')) = ANY($1::text[])
    ORDER BY c.contract_id`, [contracts.map((c) => String(c.po_number || '').trim()).filter(Boolean)])).rows;
  console.log(`\nF. B2B children pointing at these POs (${children.length}):`);
  if (!children.length) console.log('   (none)');
  for (const r of children) {
    console.log(`   ${r.contract_id}  PO ${r.po_number || '-'}  reff_po ${r.contract_reference_po}  ${r.incoterm || '-'}  ordered ${r.ordered_mt} MT`);
  }

  // G. The per-contract lines behind each STO's sums, written out by hand.
  //
  //    all_sto_contract_links gathers EVERY contract tied to an STO through contract_stos, through
  //    contracts.sto_number, or through any non-cancelled shipment on that STO. There is no PO
  //    condition anywhere in that gathering, which is why POs that merely share the STO are
  //    carried. What that alone does NOT explain is how Contract Qty reads 2,000 MT on the same
  //    row where Received reads 4,001 MT - same link set, two different totals - so something
  //    downstream drops contracts from one column and not the other. This prints both sides per
  //    contract so the asymmetry is visible rather than argued about.
  //
  //    Not composed from buildStoPoMetricsCte: that CTE needs po_sto_counts and
  //    b2b_ending_child_snapshot spliced around it, dies with 42P01 standalone, and prints several
  //    hundred KB of rendered SQL on the way out.
  if (stos.length) {
    console.log('');
    console.log('G. per-contract lines behind each STO:');
    for (const sto of stos) {
      const lines = (await connection.query(`
        SELECT l.contract_id, l.po_number, l.src,
               ROUND(l.contract_qty / 1000, 2) AS contract_qty_mt,
               ROUND((
                 SELECT NULLIF(REGEXP_REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', ''), '[^0-9.-]', '', 'g'), '')::numeric
                 FROM sap_processed_data spd
                 WHERE spd.contract_number = l.contract_id
                   AND TRIM(COALESCE(spd.sto_number::text, '')) = $1
                 ORDER BY spd.created_at DESC NULLS LAST
                 LIMIT 1
               ), 2) AS sap_receive
        FROM (
          SELECT DISTINCT ON (cc.contract_id)
                 cc.contract_id, cc.po_number, cc.quantity_ordered::numeric AS contract_qty, u.src
          FROM (
            SELECT cs.contract_id AS cid, 'contract_stos' AS src
            FROM contract_stos cs WHERE TRIM(cs.sto_number::text) = $1
            UNION ALL
            SELECT c2.id, 'contracts.sto_number'
            FROM contracts c2 WHERE TRIM(COALESCE(c2.sto_number::text, '')) = $1
            UNION ALL
            SELECT sh.contract_id, 'shipment'
            FROM shipments sh
            WHERE TRIM(COALESCE(sh.shipment_id::text, '')) = $1
              AND COALESCE(sh.status, '') <> 'CANCELLED'
          ) u
          JOIN contracts cc ON cc.id = u.cid
          ORDER BY cc.contract_id, u.src
        ) l
        ORDER BY l.contract_id`, [sto])).rows;
      console.log(`   STO ${sto} - every contract the link step gathers:`);
      console.log('      contract      PO            contract qty   SAP receive   linked via');
      let qty = 0;
      let rec = 0;
      for (const r of lines) {
        qty += Number(r.contract_qty_mt || 0);
        rec += Number(r.sap_receive || 0);
        console.log(`      ${String(r.contract_id).padEnd(14)}${String(r.po_number || '-').padEnd(14)}` +
          `${String(r.contract_qty_mt).padStart(9)} MT ${String(r.sap_receive ?? '-').padStart(11)}    ${r.src}`);
      }
      console.log(`      summed: contract qty ${qty.toFixed(2)} MT, SAP receive ${rec.toFixed(2)} MT`);
      console.log('      (a contract with a contract qty but no SAP receive here, or the reverse,');
      console.log('       is how the two columns end up over different sets)');
    }
  }

  console.log('\nRead C first. If one STO carries several contracts, anything summed by STO key');
  console.log('carries all of them, while the contract column beside it carries one - which is');
  console.log('exactly how a 2,000 MT contract ends up beside 4,001 MT received.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
