/**
 * Turn the "DHM unavailable" vessel push failures that are really DHM matches into "Waiting for DHM approval" rows (stored as CONFLICT, which is never auto-retried), WITHOUT calling DHM.
 *
 * 47 numbered barges ("BG. MAKMUR ABADI IV", "... VI", "BG. ILIR JAYA II" ...) were answered by DHM with the record of the fleet's base vessel, which another KLIP vessel is already linked to.
 * Saving that link fails on uq_master_vessels_dhm_id, which was recorded as "DHM unavailable" and retried 11 times. The Integrations page's "Kirim ulang sekarang" would send them again, and a POST
 * DHM answers 200 "updated" changes the OTHER vessel's record in DHM, so these rows must not be retried: this script moves them to CONFLICT (never auto-retried) using what DHM already answered
 * (dhm_api_calls), and only for rows whose last answer really points at a record another KLIP vessel holds.
 *
 *   docker exec -i klip-backend node dist/scripts/repairDhmVesselDuplicateStates.js           dry run: counts and samples
 *   docker exec -i klip-backend node dist/scripts/repairDhmVesselDuplicateStates.js --apply   writes
 */
import { query } from '../database/connection';

const FOUND = `
  SELECT s.entity_id, mv.vessel_name, h.vessel_name AS holder_name, COALESCE(NULLIF(trim(h.dhm_code), ''), c.response_body->'record'->'data'->>'code') AS dhm_code
    FROM dhm_push_state s
    JOIN master_vessels mv ON mv.id = s.entity_id
    JOIN LATERAL (
      SELECT response_body FROM dhm_api_calls c
       WHERE c.kind = 'push' AND c.slug = 'vessel' AND c.method IN ('POST','PUT') AND c.response_body ? 'record'
         AND upper(trim(c.request_body->>'Vessel_Name')) = upper(trim(mv.vessel_name))
       ORDER BY c.created_at DESC LIMIT 1
    ) c ON true
    JOIN master_vessels h ON h.dhm_id::text = c.response_body->'record'->>'id' AND h.id <> mv.id
   WHERE s.entity_kind = 'vessel' AND s.status = 'FAILED' AND s.error ILIKE 'DHM unavailable%'`;

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = (await query(FOUND)).rows as Array<{ entity_id: string; vessel_name: string; holder_name: string; dhm_code: string | null }>;
  const failed = (await query(`SELECT COUNT(*)::int AS n FROM dhm_push_state WHERE entity_kind = 'vessel' AND status = 'FAILED'`)).rows[0].n;
  console.log(`vessel push states FAILED: ${failed}; duplicates of a vessel DHM already links elsewhere: ${rows.length}`);
  console.table(rows.slice(0, 10).map((r) => ({ vessel: r.vessel_name, dhm_holds_as: r.holder_name, dhm_code: r.dhm_code })));
  if (!apply) {
    console.log('dry run: nothing changed. Pass --apply to move them to CONFLICT.');
    process.exit(0);
  }
  let done = 0;
  for (const r of rows) {
    const message = `Waiting for DHM approval: DHM matched this to "${r.holder_name}"${r.dhm_code ? ` (${r.dhm_code})` : ''}, which is already linked to another KLIP vessel. If it is a different ship, a DHM user approves it as a new vessel.`;
    const res = await query(
      `UPDATE dhm_push_state SET status = 'CONFLICT', error = $2, next_attempt_at = NULL WHERE entity_kind = 'vessel' AND entity_id = $1::uuid AND status = 'FAILED'`,
      [r.entity_id, message],
    );
    done += res.rowCount ?? 0;
  }
  console.log('moved to CONFLICT:', done);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
