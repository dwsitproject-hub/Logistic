/*
 * READ-ONLY: how many vessel_loading_ports rows have lost the evidence of where their value
 * came from, and how many of those are genuinely ambiguous.
 *
 *   node /app/diag-sap-mirror-asymmetry.js
 *
 * THE ASYMMETRY. Two columns describe one field, maintained by opposite rules
 * (vesselLoadingPortsFromSap.service.ts):
 *
 *     value   mergeSapPortValue   `if (hasCurrent) return current`  - fill gaps only, keeps
 *                                 whatever is there forever
 *     mirror  mergeSapSnapshot    no incoming value -> stores NULL  - reflects what SAP says NOW
 *
 * So one import in which SAP says nothing for an STO nulls the mirror while the stale value
 * survives. Migrations 169 and 170 proved a date came from SAP by testing `value = mirror`; after
 * that import the test can never fire again, and the row is indistinguishable from something a
 * user typed. Migration 173 exists because of exactly this, and STO 1006019867 proves it recurs:
 * 170 cleared it, and its mirror was NULL again with the value back.
 *
 * WHAT THIS COUNTS, per field:
 *
 *   provably SAP    value = mirror. The 169/170 test still works here.
 *   provably KLIP   the field is named in klip_edited_fields (migration 167, written only by the
 *                   KLIP edit path, never by the import).
 *   AMBIGUOUS       value set, mirror NULL, not named in klip_edited_fields. Nothing left to say
 *                   where it came from. THIS is the number the fix is worth measuring against.
 *
 * Note the trap migration 167 wrote down and this script obeys: an empty klip_edited_fields means
 * "provenance unknown", NOT "from SAP". Rows predating 167 are all empty, so ambiguous here means
 * ambiguous - not "SAP's to overwrite".
 */
const connection = require('/app/dist/database/connection');

const PAIRS = [
  ['ata_vessel_arrival', 'sap_ata_vessel_arrival'],
  ['ata_vessel_berthed', 'sap_ata_vessel_berthed'],
  ['ata_loading_start', 'sap_ata_loading_start'],
  ['ata_loading_completed', 'sap_ata_loading_completed'],
  ['ata_vessel_sailed', 'sap_ata_vessel_sailed'],
];

(async () => {
  console.log('vessel_loading_ports - where each set value can still be traced:\n');
  console.log('   field                    set   provably SAP   provably KLIP   AMBIGUOUS');

  const totals = { set: 0, sap: 0, klip: 0, amb: 0 };
  for (const [value, mirror] of PAIRS) {
    const r = (await connection.query(`
      SELECT COUNT(*) FILTER (WHERE v.${value} IS NOT NULL) AS is_set,
             COUNT(*) FILTER (WHERE v.${value} IS NOT NULL
                              AND v.${mirror} IS NOT NULL
                              AND v.${value} = v.${mirror}) AS provably_sap,
             COUNT(*) FILTER (WHERE v.${value} IS NOT NULL
                              AND $1 = ANY(v.klip_edited_fields)) AS provably_klip,
             COUNT(*) FILTER (WHERE v.${value} IS NOT NULL
                              AND v.${mirror} IS NULL
                              AND NOT ($1 = ANY(v.klip_edited_fields))) AS ambiguous
      FROM vessel_loading_ports v`, [value])).rows[0];
    totals.set += Number(r.is_set);
    totals.sap += Number(r.provably_sap);
    totals.klip += Number(r.provably_klip);
    totals.amb += Number(r.ambiguous);
    console.log('   ' + value.padEnd(24) + String(r.is_set).padStart(5) +
      String(r.provably_sap).padStart(15) + String(r.provably_klip).padStart(16) +
      String(r.ambiguous).padStart(12));
  }
  console.log('   ' + 'TOTAL'.padEnd(24) + String(totals.set).padStart(5) +
    String(totals.sap).padStart(15) + String(totals.klip).padStart(16) +
    String(totals.amb).padStart(12));

  // How much of the ambiguity is simply age. Rows that predate migration 167 could never have
  // gained a klip_edited_fields entry, so their ambiguity is expected rather than newly created.
  const byAge = (await connection.query(`
    SELECT COUNT(*) FILTER (WHERE v.updated_at >= DATE '2026-09-15') AS touched_since_167,
           COUNT(*) FILTER (WHERE v.updated_at <  DATE '2026-09-15') AS older,
           COUNT(*) AS total
    FROM vessel_loading_ports v
    WHERE v.ata_loading_completed IS NOT NULL
      AND v.sap_ata_loading_completed IS NULL
      AND NOT ('ata_loading_completed' = ANY(v.klip_edited_fields))`)).rows[0];
  console.log('\nambiguous ata_loading_completed, by when the row was last touched:');
  console.log(`   updated on/after 2026-09-15 (migration 167 era) : ${byAge.touched_since_167}`);
  console.log(`   older                                           : ${byAge.older}`);
  console.log('   (the first group is the one still being created; the second is history)');

  // The shape migration 173 cleared: a value with no mirror, on a shipment that has not sailed.
  const live = (await connection.query(`
    SELECT COUNT(*) AS n
    FROM vessel_loading_ports v
    JOIN shipments s ON s.id = v.shipment_id
    WHERE v.ata_loading_completed IS NOT NULL
      AND v.sap_ata_loading_completed IS NULL
      AND NOT ('ata_loading_completed' = ANY(v.klip_edited_fields))
      AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('SAILED', 'COMPLETED', 'CANCELLED')`)).rows[0];
  console.log(`\nof those, on shipments that have NOT sailed: ${live.n}`);
  console.log('   (a completion date on a shipment that has not sailed is impossible rather than');
  console.log('    merely doubtful - migration 173 used exactly that to clear safely)');

  console.log('\nRead the AMBIGUOUS total. If it keeps growing, the import is still erasing');
  console.log('provenance faster than migrations can repair it, and the write path is the fix.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
