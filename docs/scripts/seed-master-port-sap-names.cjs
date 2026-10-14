/*
 * Re-run the VESSEL PORT (SAP) seed after a Master Port the Port sheet names has been added. WRITES (inserts missing names only), in one transaction.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/seed-master-port-sap-names.cjs | docker exec -i klip-backend node -
 *
 * Migration 237 seeds master_port_sap_names from sheet "Port" of "Master Data - CPO 28 Sep 2026" once, with klip_seed_master_port_sap_names(). A Master Port that did not exist
 * yet then was reported, not created (a Master Port is DHM master data), so its SAP texts stayed unmapped. Add the port in Master Port, then run this: the function is
 * idempotent and never overwrites - a text that already has a port keeps it (a person's edit wins), a text that is itself a Master Port is skipped.
 *
 * Prints one line per sheet row: seeded | already there | kept: already <PORT> | skipped | port missing in Master Port. After the inserts the Master Port ids stored next to
 * the port texts are re-resolved (klip_refresh_master_port_ids; updated_at is kept) and the number of rows that changed is printed.
 */
const path = require('path');
const fs = require('fs');

const DIST = [process.env.KLIP_DIST, '/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].filter(Boolean).find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const pool = require(path.join(DIST, 'database/connection')).default;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seeded = await client.query('SELECT sap_name, port_name, status FROM klip_seed_master_port_sap_names() ORDER BY status, port_name, sap_name');
    for (const r of seeded.rows) console.log(`${r.status.padEnd(34)} | ${r.sap_name} -> ${r.port_name}`);
    const counts = {};
    for (const r of seeded.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log('\nsummary:', JSON.stringify(counts));
    const refreshed = await client.query('SELECT klip_refresh_master_port_ids() AS changed');
    console.log('rows whose Master Port id changed:', refreshed.rows[0].changed);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
