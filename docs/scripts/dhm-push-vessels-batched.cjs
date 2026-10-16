/**
 * Push Master Vessel to DHM in small batches, from the backend container. The Sync button pushes every vessel inside ONE request and
 * timed out on DHM's side (SIT 2026-10-16); this sends a few at a time with a pause, and can be stopped and run again.
 *
 *   git show origin/SIT:docs/scripts/dhm-push-vessels-batched.cjs | docker exec -i klip-backend node - [options]
 *
 *   (no option)        list what the next batch would send; nothing is sent
 *   --apply            send it
 *   --limit N          vessels per run (default 25)
 *   --delay MS         pause between two vessels (default 1500)
 *   --name "A, B"      only these vessel names (exact, case-insensitive): a one-vessel test first
 *   --stop-after N     stop the run after N failures in a row (default 3): DHM is struggling, wait before the next run
 *
 * Resumable: a run picks vessels with no DHM link yet (dhm_id NULL), so a vessel DHM confirmed is not sent again. A vessel DHM
 * answered with a CONFLICT is skipped (it needs a person); a FAILED one is tried again. Uses the same push as the Sync button
 * (dist/dhm/pushCatalog pushRow), so the link and dhm_push_state are written the same way. DHM must be Enabled (Integrations).
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};
const apply = args.includes('--apply');
const limit = Math.max(1, Number(opt('--limit', 25)) || 25);
const delay = Math.max(0, Number(opt('--delay', 1500)) || 0);
const stopAfter = Math.max(1, Number(opt('--stop-after', 3)) || 3);
const names = String(opt('--name', ''))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pool = dist('database/connection').default;
  const { isDhmEnabled } = dist('dhm/config');
  const { pushRow } = dist('dhm/pushCatalog');
  let code = 0;
  try {
    const counts = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE mv.dhm_id IS NOT NULL)::int AS linked,
              count(*) FILTER (WHERE mv.dhm_id IS NULL AND ps.status = 'CONFLICT')::int AS conflict,
              count(*) FILTER (WHERE mv.dhm_id IS NULL AND ps.status = 'FAILED')::int AS failed_before
         FROM master_vessels mv
         LEFT JOIN dhm_push_state ps ON ps.entity_kind = 'vessel' AND ps.entity_id = mv.id`,
    );
    const c = counts.rows[0];
    console.log(`== DHM vessel push (${apply ? 'APPLY' : 'LIST ONLY'}) | DHM enabled: ${isDhmEnabled()}`);
    console.log(`master vessels ${c.total}: in DHM ${c.linked}, not yet ${c.total - c.linked} (conflict ${c.conflict}, failed before ${c.failed_before})`);

    const rows = (
      await pool.query(
        `SELECT mv.* FROM master_vessels mv
           LEFT JOIN dhm_push_state ps ON ps.entity_kind = 'vessel' AND ps.entity_id = mv.id
          WHERE mv.dhm_id IS NULL AND COALESCE(ps.status, '') <> 'CONFLICT'
            AND (cardinality($1::text[]) = 0 OR upper(trim(mv.vessel_name)) = ANY($1::text[]))
          ORDER BY mv.vessel_name, mv.id
          LIMIT $2`,
        [names, limit],
      )
    ).rows;
    if (names.length) {
      const found = new Set(rows.map((r) => String(r.vessel_name).trim().toUpperCase()));
      for (const n of names) if (!found.has(n)) console.log(`  not picked: ${n} (no such vessel, already in DHM, or a CONFLICT)`);
    }
    console.log(`this run: ${rows.length} vessel(s)${apply ? `, ${delay} ms apart` : ''}`);
    if (!apply) {
      for (const r of rows) console.log(`  ${r.vessel_name} [${r.vessel_code}]`);
      console.log('Nothing sent. Add --apply to send.');
      return;
    }
    if (!isDhmEnabled()) {
      console.log('DHM is switched off (Integrations > DHM > Enabled): nothing sent.');
      code = 1;
      return;
    }

    let ok = 0;
    let conflict = 0;
    let failed = 0;
    let inARow = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const t0 = Date.now();
      const res = await pushRow('vessel', r, false);
      const ms = Date.now() - t0;
      if (res.dhmConflict) {
        conflict++;
        inARow = 0;
        console.log(`  CONFLICT ${r.vessel_name}: DHM already has ${res.dhmCode || '?'} (${ms} ms)`);
      } else if (res.dhmError || !(res.dhmStatus || res.dhmCode)) {
        failed++;
        inARow++;
        console.log(`  FAILED   ${r.vessel_name}: ${res.dhmError || 'DHM did not confirm'} (${ms} ms)`);
        if (inARow >= stopAfter) {
          console.log(`stopped: ${inARow} failures in a row. Wait a few minutes, then run again (it resumes).`);
          break;
        }
      } else {
        ok++;
        inARow = 0;
        console.log(`  ok       ${r.vessel_name} -> ${res.dhmCode} (${ms} ms)`);
      }
      if (i < rows.length - 1) await sleep(delay);
    }
    const left = (await pool.query(`SELECT count(*)::int AS n FROM master_vessels WHERE dhm_id IS NULL`)).rows[0].n;
    console.log(`result: ok ${ok}, conflict ${conflict}, failed ${failed} | still not in DHM: ${left}`);
    if (failed) code = 1;
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    await pool.end().catch(() => undefined);
    process.exit(code);
  }
})();
