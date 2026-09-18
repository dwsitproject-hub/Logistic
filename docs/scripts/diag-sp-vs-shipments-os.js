/*
 * READ-ONLY: why Shipping Performance and Shipments report different outstanding for the same
 * product and site, decomposed by cause.
 *
 *   node /app/diag-sp-vs-shipments-os.js                 (defaults to CPO / BONTANG)
 *   node /app/diag-sp-vs-shipments-os.js "CPO" "BONTANG"
 *
 * Reported case: CPO / Bontang reads 49,107 MT on Shipping Performance and 80,939 MT on Shipments,
 * a gap of 31,832 MT.
 *
 * TWO CANDIDATE CAUSES, and reading the code has already settled one of them:
 *
 *   MEMBERSHIP. Shipments counts two arms - shipments that exist, AND contracts that have no
 *   shipment at all. Shipping Performance is built from shipments, so the second arm cannot appear
 *   there however the numbers are computed. This script measures that arm directly.
 *
 *   THE SITE FILTER ITSELF - eliminated for this case, but worth recording. The two pages derive
 *   "site" differently: Shipping Performance takes the raw discharge destination
 *   (COALESCE(b2b_end, sa, l) ... 'Blank'), while the Shipments Region/Site filter runs it through
 *   sqlNormalizeDischargeDestination first. So the same contract can sit under two different sites
 *   on the two pages. The alias map holds exactly one entry - KIJING -> TANJUNG PURA - so it cannot
 *   affect Bontang, but it will affect Tanjung Pura, and this script prints the overlap so that
 *   shows up rather than being assumed away.
 *
 * Deliberately does NOT reproduce the Shipments page query. That query is enormous and copying it
 * would mean measuring my copy rather than the page. Instead it takes the Shipping Performance
 * rowset as given and asks what exists OUTSIDE it, which is the question that matters.
 */
const connection = require('/app/dist/database/connection');
const {
  buildShippingPerformanceSql,
  aggregateShippingPerformanceRowsBySto,
} = require('/app/dist/services/shippingPerformance.service');
const { sumShippingPerfOutstandingQtyKg } = require('/app/dist/utils/shippingPerformanceOutstandingAgg');
const { sqlRegionSiteDisplayForContract } = require('/app/dist/utils/regionSiteSql');
const { sapStoTypeNormalizedExpr } = require('/app/dist/utils/shipmentStoTypeSql');

const PRODUCT = (process.argv[2] || 'CPO').trim().toUpperCase();
const SITE = (process.argv[3] || 'BONTANG').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const up = (v) => String(v ?? '').trim().toUpperCase();

(async () => {
  console.log(`scope: product ${PRODUCT}, site ${SITE}\n`);
  console.log('running the Shipping Performance query...');
  const all = aggregateShippingPerformanceRowsBySto(
    (await connection.query(await buildShippingPerformanceSql())).rows,
  );
  const inScope = all.filter(
    (r) => up(r.product).includes(PRODUCT) && up(r.plant_site).includes(SITE),
  );
  const spTotal = sumShippingPerfOutstandingQtyKg(inScope);
  const spContracts = new Set();
  for (const r of inScope) {
    for (const cn of String(r.contract_number ?? '').split(/\s*,\s*/)) {
      if (cn.trim()) spContracts.add(cn.trim());
    }
  }

  console.log(`\nA. Shipping Performance, ${PRODUCT} / ${SITE}:`);
  console.log(`   rows      : ${inScope.length}`);
  console.log(`   contracts : ${spContracts.size}`);
  console.log(`   outstanding (apportioned) : ${mt(spTotal)} MT`);

  // B. Contracts in the same product/site that Shipping Performance has no row for.
  //
  //    Outstanding comes straight from contract_qty_move_snapshot rather than through
  //    sqlContractGlobalOutstandingExpr. That expression needs the qty_move CTE spliced in around
  //    it, and an earlier version of this script asked for it without defining the scope CTE it
  //    depends on: the query died with 42P01 and the connection logger printed several hundred KB
  //    of generated SQL to the terminal. The snapshot holds the same figures, keyed by contract
  //    number, and needs nothing around it.
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const known = [...spContracts];
  let outside = null;
  try {
    outside = (await connection.query(`
      SELECT c.contract_id, c.incoterm, c.product,
             ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 1) AS ordered_mt,
             ROUND(GREATEST(
               COALESCE(c.quantity_ordered, 0) - CASE
                 WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) = 'FOB' THEN COALESCE(qms.quantity_delivery, 0)
                 ELSE COALESCE(qms.quantity_receive, 0)
               END, 0) / 1000, 1) AS os_mt,
             (SELECT COUNT(*) FROM shipments sh
               WHERE sh.contract_id = c.id AND COALESCE(sh.status, '') <> 'CANCELLED') AS shipment_rows
      FROM contracts c
      LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
      WHERE UPPER(TRIM(COALESCE(c.product, ''))) LIKE '%' || $1 || '%'
        AND UPPER(TRIM(COALESCE((${regionSite}), ''))) LIKE '%' || $2 || '%'
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF', 'CFR')
        AND NOT (c.contract_id = ANY($3::text[]))
      ORDER BY 5 DESC`, [PRODUCT, SITE, known])).rows;
  } catch (err) {
    // Never let a failure print the generated SQL - the message alone is the useful part.
    console.log(`\nB. could not be measured: ${String(err.message).slice(0, 200)}`);
  }

  if (outside) {
    const rows = outside.filter((r) => Number(r.os_mt) > 0);
    const kg = (rs) => rs.reduce((a, r) => a + Number(r.os_mt || 0), 0) * 1000;
    const noShipment = rows.filter((r) => Number(r.shipment_rows) === 0);
    const withShipment = rows.filter((r) => Number(r.shipment_rows) > 0);
    console.log(`\nB. contracts in the same product/site with NO Shipping Performance row:`);
    console.log(`   contracts   : ${rows.length}`);
    console.log(`   outstanding : ${mt(kg(rows))} MT`);
    console.log(`   no shipment at all : ${noShipment.length} contracts, ${mt(kg(noShipment))} MT  <- the backlog arm`);
    console.log(`   HAS a shipment     : ${withShipment.length} contracts, ${mt(kg(withShipment))} MT  <- this one needs explaining`);
    console.log(`\n   Shipping Performance ${mt(spTotal)} + outside ${mt(kg(rows))} = ${mt(spTotal + kg(rows))} MT`);

    console.log(`\nC. largest contracts outside Shipping Performance (top 15):`);
    console.log('   contract      inc    product          ordered      OS   shipments');
    for (const r of rows.slice(0, 15)) {
      console.log('   ' + String(r.contract_id).padEnd(14) + String(r.incoterm || '-').padEnd(7) +
        String(r.product || '-').slice(0, 16).padEnd(17) +
        String(r.ordered_mt).padStart(8) + String(r.os_mt).padStart(8) +
        String(r.shipment_rows).padStart(11));
    }
  }


  // D. The "HAS a shipment" contracts, split by the only two things that can explain them.
  //
  //    Either Shipping Performance has no row for the contract at all - which would be a real gap -
  //    or it HAS one, filed under a different product or site. The second is live: SP derives site
  //    from the raw discharge destination while the filter above uses the normalised Region/Site,
  //    so the same contract can sit under two different labels on the two pages.
  if (outside) {
    const byContract = new Map();
    for (const r of all) {
      for (const cn of String(r.contract_number ?? '').split(/,/)) {
        const k = cn.trim();
        if (!k) continue;
        if (!byContract.has(k)) byContract.set(k, []);
        byContract.get(k).push(r);
      }
    }
    const withShip = outside.filter((r) => Number(r.os_mt) > 0 && Number(r.shipment_rows) > 0);
    const elsewhere = [];
    const absent = [];
    for (const r of withShip) {
      (byContract.has(r.contract_id) ? elsewhere : absent).push(r);
    }
    console.log(`\nD. the ${withShip.length} contracts that HAVE a shipment but no row in this slice:`);
    console.log(`   present in Shipping Performance under another product/site : ${elsewhere.length}`);
    console.log(`   absent from Shipping Performance entirely                  : ${absent.length}   <- a real gap if non-zero`);
    for (const r of elsewhere) {
      const where = byContract.get(r.contract_id)
        .map((x) => `${String(x.product || '-')} / ${String(x.plant_site || '-')}`);
      console.log(`      ${r.contract_id}  filed under: ${[...new Set(where)].join(', ')}`);
    }
    for (const r of absent) {
      console.log(`      ${r.contract_id}  ${r.incoterm || '-'}  ${r.shipment_rows} shipment(s), ${r.os_mt} MT  - ABSENT`);
    }
  }


  // E. Why the absent ones are absent. Shipping Performance's row scope is
  //    (sea incoterm) AND NOT (FOB AND resolved STO type = 'T') - a FOB contract's TRUCKING leg is
  //    deliberately not on a sea-performance page, the same rule that keeps STO 1016010384 off the
  //    Shipments page. Every absent contract here is FOB, so this checks the type rather than
  //    inferring it from the pattern.
  if (outside) {
    const absentIds = outside
      .filter((r) => Number(r.os_mt) > 0 && Number(r.shipment_rows) > 0)
      .map((r) => r.contract_id);
    if (absentIds.length) {
      try {
        const types = (await connection.query(`
          SELECT c.contract_id,
                 NULLIF(TRIM(s.shipment_id::text), '') AS sto,
                 s.status AS shipment_status,
                 NULLIF(TRIM(s.vessel_name), '') AS vessel_name,
                 (SELECT ${sapStoTypeNormalizedExpr('spd')}
                    FROM sap_processed_data spd
                   WHERE TRIM(COALESCE(spd.sto_number::text, '')) = TRIM(COALESCE(s.shipment_id::text, ''))
                   ORDER BY spd.created_at DESC NULLS LAST
                   LIMIT 1) AS sap_sto_type
          FROM contracts c
          JOIN shipments s ON s.contract_id = c.id AND COALESCE(s.status, '') <> 'CANCELLED'
          WHERE c.contract_id = ANY($1::text[])
          ORDER BY c.contract_id`, [absentIds])).rows;
        console.log(`\nE. the absent contracts' shipments, and their SAP STO type:`);
        console.log('   contract      STO            status        vessel               STO type');
        let typeT = 0;
        for (const r of types) {
          if (String(r.sap_sto_type || '').trim().toUpperCase() === 'T') typeT += 1;
          console.log('      ' + String(r.contract_id).padEnd(14) + String(r.sto || '-').padEnd(15) +
            String(r.shipment_status || '-').padEnd(14) +
            String(r.vessel_name || '-').slice(0, 20).padEnd(21) +
            String(r.sap_sto_type || '-'));
        }
        console.log(`   of ${types.length} shipments, ${typeT} are SAP STO type T (a FOB trucking leg)`);
        console.log('   (type T is excluded from Shipping Performance on purpose, so those are');
        console.log('    definition, not a gap. Anything NOT type T here is the real finding.)');
      } catch (err) {
        console.log(`\nE. could not be measured: ${String(err.message).slice(0, 200)}`);
      }
    }
  }


  // F. My type-T guess was wrong: production says all 14 are SAP STO type V, real sea legs with
  //    real vessels. What the data shows instead is that they SHARE STOs - seven contracts on
  //    1006018515, two each on 1006019007, 1006019499 and 1006019951 - and Shipping Performance
  //    merges its rows by STO (218 rows carrying 495 contracts).
  //
  //    So there are two quite different possibilities left, and they need opposite fixes:
  //      - the STO is in Shipping Performance but its contract_number list does not name these
  //        contracts, so they only LOOK absent (a naming problem, in the page or in my detection)
  //      - the STO is not there at all (a real gap)
  if (outside) {
    const absentIds = new Set(outside
      .filter((r) => Number(r.os_mt) > 0 && Number(r.shipment_rows) > 0)
      .map((r) => r.contract_id));
    if (absentIds.size) {
      try {
        const stos = (await connection.query(`
          SELECT DISTINCT c.contract_id, NULLIF(TRIM(s.shipment_id::text), '') AS sto
          FROM contracts c
          JOIN shipments s ON s.contract_id = c.id AND COALESCE(s.status, '') <> 'CANCELLED'
          WHERE c.contract_id = ANY($1::text[])`, [[...absentIds]])).rows;
        const spBySto = new Map();
        for (const r of all) {
          const k = String(r.sto_key ?? r.sto_number ?? '').trim();
          if (k) spBySto.set(k, r);
        }
        console.log(`\nF. is the STO itself present in Shipping Performance?`);
        const seen = new Set();
        for (const r of stos) {
          if (!r.sto || seen.has(r.sto)) continue;
          seen.add(r.sto);
          const hit = spBySto.get(r.sto);
          if (hit) {
            const names = String(hit.contract_number ?? '').split(/,/).map((x) => x.trim()).filter(Boolean);
            console.log(`   STO ${r.sto}: PRESENT, naming ${names.length} contract(s) - ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' ...' : ''}`);
          } else {
            console.log(`   STO ${r.sto}: NOT in Shipping Performance at all  <- a real gap`);
          }
        }
        console.log('   (PRESENT means the quantity IS counted, under an STO whose contract list');
        console.log('    leaves these numbers out - so the total is right and the attribution is not)');
      } catch (err) {
        console.log(`\nF. could not be measured: ${String(err.message).slice(0, 200)}`);
      }
    }
  }


  // G. Shipping Performance's WHERE ends with:
  //
  //      AND NOT (l.contract_number IS NOT NULL
  //               AND COALESCE(l.b2b_flag, '') = 'B2B'
  //               AND l.contract_reference_po IS NOT NULL)
  //
  //    - it drops B2B CHILD contracts, presumably so their quantity is not counted twice beside
  //    the origin's. That would explain both shapes at once: an STO whose only contracts are
  //    children disappears entirely, and an STO with a mixture keeps the row but names only the
  //    non-children.
  //
  //    Whether that loses anything depends on one further fact: is the ORIGIN in Shipping
  //    Performance, carrying the quantity? If it is, nothing is lost and only attribution is off.
  //    If it is not, the quantity is genuinely gone from the page.
  if (outside) {
    const absentIds = [...new Set(outside
      .filter((r) => Number(r.os_mt) > 0 && Number(r.shipment_rows) > 0)
      .map((r) => r.contract_id))];
    if (absentIds.length) {
      try {
        const info = (await connection.query(`
          SELECT c.contract_id,
                 snap.b2b_flag_raw AS b2b_flag,
                 snap.contract_reference_po_raw AS reff_po,
                 (SELECT o.contract_id FROM contracts o
                   WHERE NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(snap.contract_reference_po_raw), '')
                   LIMIT 1) AS origin_contract
          FROM contracts c
          LEFT JOIN contract_latest_spd_snapshot snap ON snap.contract_number = c.contract_id
          WHERE c.contract_id = ANY($1::text[])
          ORDER BY c.contract_id`, [absentIds])).rows;
        const spNames = new Set();
        for (const r of all) {
          for (const cn of String(r.contract_number ?? '').split(/,/)) {
            const k = cn.trim();
            if (k) spNames.add(k);
          }
        }
        let children = 0;
        let originMissing = 0;
        console.log(`\nG. are they B2B children, and is the origin on the page?`);
        console.log('   contract      b2b    reff PO        origin        origin in SP?');
        for (const r of info) {
          const isChild = String(r.b2b_flag || '').trim().toUpperCase() === 'B2B' && r.reff_po;
          if (isChild) children += 1;
          const originIn = r.origin_contract ? spNames.has(String(r.origin_contract).trim()) : false;
          if (isChild && !originIn) originMissing += 1;
          console.log('      ' + String(r.contract_id).padEnd(14) + String(r.b2b_flag || '-').padEnd(7) +
            String(r.reff_po || '-').padEnd(15) + String(r.origin_contract || '-').padEnd(14) +
            (r.origin_contract ? (originIn ? 'yes' : 'NO') : 'n/a'));
        }
        console.log(`   B2B children: ${children} of ${info.length}`);
        console.log(`   children whose ORIGIN is also absent: ${originMissing}  <- quantity genuinely lost`);
      } catch (err) {
        console.log(`\nG. could not be measured: ${String(err.message).slice(0, 200)}`);
      }
    }
  }


  console.log('\nRead B first. A contract with no shipment at all cannot appear on a page built');
  console.log('from shipments, so that line is a definition difference rather than a fault. The');
  console.log('line below it - contracts that DO have a shipment yet are missing from Shipping');
  console.log('Performance - is the one that would be a real gap.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
