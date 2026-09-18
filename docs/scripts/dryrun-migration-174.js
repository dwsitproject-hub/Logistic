/*
 * READ-ONLY dry run for migration 174 — shows exactly which rows it would clear, and changes
 * nothing. Run this BEFORE deploying, because the container entrypoint applies migrations on
 * start: by the time the backend is up, 174 has already run.
 *
 *   node /app/dryrun-migration-174.js
 *
 * It repeats 174's SELECT verbatim. If this prints rows you do not want cleared, do not deploy -
 * change the migration first.
 */
const connection = require('/app/dist/database/connection');

(async () => {
  const rows = (await connection.query(`
    SELECT v.id AS vlp_id,
           c.contract_id,
           NULLIF(TRIM(s.shipment_id::text), '') AS own_sto,
           s.vessel_name,
           s.status AS shipment_status,
           v.ata_loading_completed::date AS ata_to_clear,
           v.is_discharge_port
    FROM vessel_loading_ports v
    JOIN shipments s ON s.id = v.shipment_id
    LEFT JOIN contracts c ON c.id = s.contract_id
    WHERE v.ata_loading_completed IS NOT NULL
      AND v.sap_ata_loading_completed IS NULL
      AND NOT ('ata_loading_completed' = ANY(v.klip_edited_fields))
      AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('SAILED', 'COMPLETED', 'CANCELLED')
    ORDER BY c.contract_id, own_sto`)).rows;

  console.log(`\nmigration 174 would clear ${rows.length} row(s):\n`);
  if (!rows.length) {
    console.log('   (none — nothing to do, and the migration is a no-op)');
  } else {
    console.log('   contract      STO            vessel                    status      ATA cleared  discharge?');
    for (const r of rows) {
      console.log('   ' + String(r.contract_id || '-').padEnd(14) +
        String(r.own_sto || '-').padEnd(15) +
        String(r.vessel_name || '-').slice(0, 24).padEnd(26) +
        String(r.shipment_status || '-').padEnd(12) +
        String(r.ata_to_clear ? new Date(r.ata_to_clear).toISOString().slice(0, 10) : '-').padEnd(13) +
        String(r.is_discharge_port));
    }
  }

  // The rows 174 deliberately leaves alone, for contrast. If this number climbs over the months,
  // the write path is still losing provenance and the question reopens.
  const left = (await connection.query(`
    SELECT COUNT(*) AS n
    FROM vessel_loading_ports v
    WHERE v.ata_loading_completed IS NOT NULL
      AND v.sap_ata_loading_completed IS NULL
      AND NOT ('ata_loading_completed' = ANY(v.klip_edited_fields))`)).rows[0];
  console.log(`\nambiguous ata_loading_completed rows in total: ${left.n}`);
  console.log('   174 touches only the ones on shipments that have not sailed. The rest are');
  console.log('   unexplained, not wrong, and clearing those would treat "we no longer know" as');
  console.log('   "it is false" — the inference migration 167 exists to forbid.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
