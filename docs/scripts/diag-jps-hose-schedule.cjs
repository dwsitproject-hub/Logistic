/*
 * READ-ONLY: how JPS reports Hose On / Hose Off (schedule.cargo_ops_start_at / cargo_ops_end_at) and the stages around them, against what KLIP stored.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-jps-hose-schedule.cjs | docker exec -i klip-backend node - 2>&1 | tail -90
 *
 * JPS told us the mechanism from Hose On to Hose Off changed. The partner doc (v5.7) says both are the Cargo Operations OPERATION WINDOW start / end; the live catalog now describes
 * them as "Hose On (Opening), earliest Opening start" and "Hose Off (Closing), Closing time". This shows what the real instructions look like so the mapping can be judged on data:
 *   1. the stages and times KLIP stored for the instructions that got past allocation (newest first),
 *   2. oddities in them: Hose Off before Hose On, Hose Off set while the stage is still Start Cargo, a stage with its time missing, Hose Off after sailing,
 *   3. the same instructions read from JPS NOW (GET /shipping-instructions/{id}), side by side with the stored values, so a changed meaning shows as a difference.
 * Makes only GET calls through KLIP's own client (they show in Integrations > JPS > History). Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const wib = (v) => (v ? new Date(new Date(v).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const pool = load('database/connection').default;
  const { jpsRequest } = load('jps/client');
  const cfg = load('jps/config');
  let host = '(not set)';
  try { host = new URL(cfg.jpsBaseUrl()).host; } catch { /* keep */ }
  console.log(`JPS enabled: ${cfg.isJpsEnabled()}   host: ${host}   (times below are WIB)\n`);

  const rows = (await pool.query(
    `SELECT DISTINCT ON (sto_key) sto_key, revision, state, jps_id, jps_status, schedule_ta, schedule_tb, schedule_cargo_ops_start_at, schedule_cargo_ops_end_at,
            schedule_tc, schedule_cast_off_at, schedule_sailed_at, last_polled_at
       FROM jps_shipping_instructions
      WHERE jps_id IS NOT NULL
        AND COALESCE(jps_status, '') IN ('Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Sailed Off', 'Sailed', 'Approved')
      ORDER BY sto_key, revision DESC`,
  )).rows;
  rows.sort((a, b) => new Date(b.last_polled_at || 0) - new Date(a.last_polled_at || 0));
  console.log(`Instructions past approval (newest revision per STO): ${rows.length}\n`);

  console.log('--- 1. what KLIP stored (newest polled first, at most 25)');
  console.table(rows.slice(0, 25).map((r) => ({
    sto: String(r.sto_key).slice(0, 14), rev: r.revision, status: r.jps_status,
    ta: wib(r.schedule_ta), tb: wib(r.schedule_tb), hose_on: wib(r.schedule_cargo_ops_start_at), hose_off: wib(r.schedule_cargo_ops_end_at),
    tc: wib(r.schedule_tc), cast_off: wib(r.schedule_cast_off_at), sailed: wib(r.schedule_sailed_at),
  })));

  console.log('--- 2. oddities in what was stored');
  const odd = [];
  const t = (v) => (v ? new Date(v).getTime() : null);
  for (const r of rows) {
    const on = t(r.schedule_cargo_ops_start_at);
    const off = t(r.schedule_cargo_ops_end_at);
    const why = [];
    if (on && off && off < on) why.push('Hose Off BEFORE Hose On');
    if (['Start Cargo'].includes(r.jps_status) && off) why.push('Hose Off already set while the stage is still Start Cargo');
    if (['Start Cargo', 'Cargo Done', 'Sailed Off', 'Sailed'].includes(r.jps_status) && !on) why.push('stage past Start Cargo but no Hose On');
    if (['Cargo Done', 'Sailed Off', 'Sailed'].includes(r.jps_status) && !off) why.push('stage past Cargo Done but no Hose Off');
    if (off && t(r.schedule_cast_off_at) && t(r.schedule_cast_off_at) < off) why.push('cast off BEFORE Hose Off');
    if (off && t(r.schedule_tc) && Math.abs(t(r.schedule_tc) - off) > 60 * 60 * 1000) why.push('tc differs from Hose Off by more than 1 h');
    if (why.length) odd.push({ sto: String(r.sto_key).slice(0, 14), status: r.jps_status, hose_on: wib(r.schedule_cargo_ops_start_at), hose_off: wib(r.schedule_cargo_ops_end_at), what: why.join('; ') });
  }
  console.table(odd.slice(0, 25));
  console.log(`${odd.length} of ${rows.length} instructions show at least one of these.\n`);

  console.log('--- 3. the same instructions as JPS reports them NOW (stored vs live; a difference is a changed value or meaning)');
  const out = [];
  for (const r of rows.slice(0, 12)) {
    const res = await jpsRequest({ method: 'GET', url: `/shipping-instructions/${r.jps_id}` }, { requireEnabled: false });
    if (!res.ok) { out.push({ sto: String(r.sto_key).slice(0, 14), live_status: 'HTTP ' + res.status + ' ' + res.code }); continue; }
    const d = res.data || {};
    const s = d.schedule || {};
    const same = (a, b) => (wib(a) === wib(b) ? '' : '  <- differs');
    out.push({
      sto: String(r.sto_key).slice(0, 14),
      stored_status: r.jps_status,
      live_status: d.status,
      hose_on_stored: wib(r.schedule_cargo_ops_start_at),
      hose_on_live: wib(s.cargo_ops_start_at) + same(r.schedule_cargo_ops_start_at, s.cargo_ops_start_at),
      hose_off_stored: wib(r.schedule_cargo_ops_end_at),
      hose_off_live: wib(s.cargo_ops_end_at) + same(r.schedule_cargo_ops_end_at, s.cargo_ops_end_at),
      cargo_done_live: wib(s.cargo_done_at),
      tc_live: wib(s.tc),
    });
  }
  console.table(out);
  console.log('A "<- differs" on hose_off means JPS now reports a different Hose Off than KLIP stored from the earlier poll: the meaning or the source of the field moved.');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
