/*
 * Re-read the JPS schedule of instructions that are past approval and bring KLIP's stored copy (and the JPS lane of the discharge ATA) back to what JPS reports NOW.
 *
 *   DRY RUN (default, writes nothing):
 *     cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/resync-jps-schedule.cjs | docker exec -i klip-backend node -
 *   WRITE:
 *     cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/resync-jps-schedule.cjs | docker exec -i -e APPLY=1 klip-backend node -
 *
 * WHY. On 2026-11-16 JPS changed where Hose On and Hose Off come from (Opening / Closing instead of the Cargo Operations window) and recalculates them on every GET, without
 * replaying webhooks. Times KLIP stored from earlier polls can therefore be ones JPS no longer reports: a Hose Off that is now null, a Hose On that moved. A sailed
 * instruction was not polled any more, so nothing corrected them. Run this ONCE after the backend that clears a null time (commit "JPS: a time JPS sends as null is
 * cleared") is deployed: the write goes through applyJpsInstruction, the same function the poll and the webhook use, which then also rewrites the JPS lane of the
 * shipments' ATA from the same response (null included).
 *
 * It makes only GET calls to JPS (they show in Integrations > JPS > History), at most one per instruction, and skips an instruction polled in the last 5 minutes
 * (JPS's limit). The dry run prints stored against live for ta, tb, Hose On and Hose Off.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const APPLY = process.env.APPLY === '1';
const wib = (v) => (v ? new Date(new Date(v).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
const same = (a, b) => wib(a) === wib(b);

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const pool = load('database/connection').default;
  const { jpsRequest } = load('jps/client');
  const { applyJpsInstruction } = load('jps/applyInstruction');
  const cfg = load('jps/config');
  console.log(`${APPLY ? 'WRITE' : 'DRY RUN'}   JPS enabled: ${cfg.isJpsEnabled()}   (times are WIB)\n`);

  const rows = (await pool.query(
    `SELECT DISTINCT ON (sto_key) id, sto_key, revision, jps_id, jps_status, last_polled_at,
            schedule_ta, schedule_tb, schedule_cargo_ops_start_at, schedule_cargo_ops_end_at
       FROM jps_shipping_instructions
      WHERE state = 'SUBMITTED' AND jps_id IS NOT NULL
        AND COALESCE(jps_status, '') IN ('Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Sailed Off', 'Sailed')
      ORDER BY sto_key, revision DESC`,
  )).rows;
  console.log(`Instructions past approval: ${rows.length}\n`);

  const out = [];
  let changed = 0;
  for (const r of rows) {
    const recent = r.last_polled_at && Date.now() - new Date(r.last_polled_at).getTime() < 5 * 60 * 1000;
    if (recent) { out.push({ sto: String(r.sto_key).slice(0, 14), result: 'skipped: polled in the last 5 minutes' }); continue; }
    const res = await jpsRequest({ method: 'GET', url: `/shipping-instructions/${r.jps_id}` }, { requireEnabled: false });
    if (!res.ok) { out.push({ sto: String(r.sto_key).slice(0, 14), result: `JPS ${res.status} ${res.code}` }); continue; }
    const d = res.data || {};
    const s = d.schedule || {};
    const diff = [];
    if (!same(r.schedule_ta, s.ta)) diff.push('ta');
    if (!same(r.schedule_tb, s.tb)) diff.push('tb');
    if (!same(r.schedule_cargo_ops_start_at, s.cargo_ops_start_at)) diff.push('hose_on');
    if (!same(r.schedule_cargo_ops_end_at, s.cargo_ops_end_at)) diff.push('hose_off');
    if (String(r.jps_status || '') !== String(d.status || '')) diff.push('status');
    if (diff.length) changed += 1;
    if (APPLY && diff.length) await applyJpsInstruction(r.id, d);
    out.push({
      sto: String(r.sto_key).slice(0, 14),
      status: `${r.jps_status} -> ${d.status}`,
      hose_on: `${wib(r.schedule_cargo_ops_start_at)} -> ${wib(s.cargo_ops_start_at)}`,
      hose_off: `${wib(r.schedule_cargo_ops_end_at)} -> ${wib(s.cargo_ops_end_at) || '(null)'}`,
      result: diff.length ? (APPLY ? `rewritten (${diff.join(', ')})` : `would change: ${diff.join(', ')}`) : 'same',
    });
  }
  console.table(out);
  console.log(APPLY ? `${changed} instruction(s) rewritten from what JPS reports now.` : `${changed} instruction(s) would change. Run again with -e APPLY=1 to write.`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
