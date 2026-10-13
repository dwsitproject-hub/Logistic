/**
 * READ-ONLY. Which master vessels were INPUT IN KLIP (Add New Vessel) and must be carried into the new master, not replaced?
 *
 * The master is being migrated to cleaner data; what the SAP import made is meant to be replaced. A vessel typed into KLIP often exists in SAP nowhere
 * yet, so a cleanup built from SAP + Jovin would drop it - and deleting a master vessel also deletes its SAP code aliases and pairs (ON DELETE CASCADE)
 * and unlinks its shipments (SET NULL). master_vessels.klip_origin (migration 234) marks them; this lists them with what migrating each one involves.
 *
 *   list     cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/master-vessel-protection.cjs \
 *              | docker exec -i klip-backend node -
 *   as JSON  ... | docker exec -i klip-backend node - --json
 *   one      ... | docker exec -i klip-backend node - --check "BG. METRO 05.35"      (a name, or a master vessel id)
 *
 * For each vessel: its code, status, owner, capacity, when it was created, how many shipments use it (active / cancelled - found through master_vessel_id,
 * the code and its aliases, and the name, because master_vessel_id alone is wrong on ~6% of production shipments) and whether DHM knows it.
 * A vessel with active shipments has to be carried into the new master AND have those shipments repointed. Nothing is written.
 *
 * To exempt one deliberately in a merge: merge-master-vessel.cjs --allow-protected. To un-flag one that should not have been flagged (for example a
 * vessel the SAP import created that the backfill caught): UPDATE master_vessels SET klip_origin = FALSE WHERE vessel_code = '...';
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

(async () => {
  const pool = dist('database/connection').default;
  const svc = dist('services/masterVesselProtection.service');
  const asJson = process.argv.includes('--json');
  const check = arg('--check');
  const db = { query: (sql, params) => pool.query(sql, params) };
  try {
    if (check) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(check);
      const found = await pool.query(
        isUuid
          ? 'SELECT id::text AS id FROM master_vessels WHERE id = $1::uuid'
          : 'SELECT id::text AS id FROM master_vessels WHERE upper(trim(vessel_name)) = upper(trim($1))',
        [check],
      );
      if (found.rows.length === 0) {
        console.error(`No master vessel matches "${check}".`);
        process.exitCode = 1;
        return;
      }
      const map = await svc.loadMasterVesselProtection(db, found.rows.map((r) => r.id));
      for (const p of map.values()) {
        console.log(asJson ? JSON.stringify(p) : `${p.protected ? 'PROTECTED' : 'not protected'}  ${p.vesselName} [${p.vesselCode}]  shipments ${p.shipmentsActive} active / ${p.shipmentsCancelled} cancelled  dhm=${p.linkedToDhm ? 'yes' : 'no'}${p.reasons.map((r) => '\n    - ' + r.message).join('')}`);
      }
      return;
    }

    const list = await svc.loadKlipOriginVessels(db);
    const detail = await pool.query(
      `SELECT mv.id::text AS id, mv.vessel_owner, mv.vessel_capacity_mt, mv.vessel_type, mv.code_status, to_char(mv.created_at, 'YYYY-MM-DD HH24:MI') AS created
         FROM master_vessels mv WHERE COALESCE(mv.klip_origin, FALSE) IS TRUE`,
    );
    const by = new Map(detail.rows.map((r) => [r.id, r]));
    if (asJson) {
      for (const p of list) console.log(JSON.stringify({ ...p, ...(by.get(p.id) || {}) }));
      return;
    }
    console.log(`KLIP-input master vessels: ${list.length}\n`);
    for (const p of list) {
      const d = by.get(p.id) || {};
      console.log(
        `${(d.created || '').padEnd(17)} ${String(p.vesselCode).padEnd(24)} ${String(p.vesselName).padEnd(34)} ${String(d.code_status || '').padEnd(11)} ` +
          `owner=${d.vessel_owner || '-'}  cap=${d.vessel_capacity_mt || '-'}  shipments ${p.shipmentsActive}/${p.shipmentsCancelled}  dhm=${p.linkedToDhm ? 'yes' : 'no'}`,
      );
    }
    const used = list.filter((p) => p.shipmentsActive > 0);
    console.log(`\n${used.length} of them have active shipments: carry the vessel AND repoint those shipments when the master is migrated.`);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
