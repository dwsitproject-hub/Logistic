/*
 * READ-ONLY smoke test of every query that carries the "an ATC finishes a contract only when every live shipment has one" rule (commit 3d9db5e6).
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-ata-rule-smoke.cjs | docker exec -i klip-backend node -
 *
 * The rule went into six queries and the SQL could not be run where it was written, so this runs each one against the real database through the same handlers the
 * pages call and says whether it answered. A column or alias that does not exist shows here as an error message, not as an empty page later.
 *   - Contracts list (the CP flags: requireRegionSite, status Open / Close)
 *   - late-performance summary, tree, data (the cards and the drilldown) with status Open / Close and a Planning Status
 *   - getLatePerformance (the older combined endpoint)
 *   - Shipments list (it carries the OS summary that now applies the same rule)
 * Writes nothing. The handlers cache a good answer for 60 s per query, which is harmless here.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

// The handlers answer a generic 500 and put the real reason (the database error) in the log. Catch it here so the note says what failed.
const logged = [];
(() => {
  const mod = load('utils/logger');
  const logger = mod.default || mod.logger || mod;
  const original = logger.error ? logger.error.bind(logger) : null;
  logger.error = (...args) => {
    const err = args.find((a) => a && typeof a === 'object' && (a.message || a.code));
    logged.push(String((err && err.message) || args.map(String).join(' ')).replace(/\s+/g, ' ').slice(0, 160));
    if (original && !/Query error|late performance/i.test(String(args[0]))) original(...args);
  };
})();

function ask(handler, query) {
  return new Promise((resolve) => {
    const started = Date.now();
    let code = 200;
    let done = false;
    const finish = (body) => { if (!done) { done = true; resolve({ code, body, ms: Date.now() - started }); } };
    const res = {
      status(c) { code = c; return res; },
      json(body) { finish(body); return res; },
      send(body) { finish(body); return res; },
      set() { return res; },
      setHeader() { return res; },
      headersSent: false,
    };
    Promise.resolve(handler({ query, headers: {}, user: { id: 'diag', role: 'ADMIN' } }, res)).catch((e) => {
      code = 500;
      finish({ success: false, thrown: String(e && e.message ? e.message : e) });
    });
  });
}

(async () => {
  const c = load('controllers/contract.controller');
  const sh = load('controllers/shipment.controller');
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const cp = { scope: 'filtered', dateFrom: `${year}-01-01`, dateTo: today };
  const cases = [
    ['Contracts list, CP flags, status Open', c.getContracts, { page: '1', limit: '20', ...cp, requireRegionSite: 'true', compact: 'true', status: 'Open' }],
    ['Contracts list, CP flags, status Close', c.getContracts, { page: '1', limit: '20', ...cp, requireRegionSite: 'true', compact: 'true', status: 'Close' }],
    ['Contracts list, plain page (no CP flags)', c.getContracts, { page: '1', limit: '20' }],
    ['late-performance summary, status Open', c.getLatePerformanceSummary, { ...cp, status: 'Open' }],
    ['late-performance summary, status Close', c.getLatePerformanceSummary, { ...cp, status: 'Close' }],
    ['late-performance tree, status Open', c.getLatePerformanceTree, { ...cp, status: 'Open' }],
    ['late-performance tree, status Close', c.getLatePerformanceTree, { ...cp, status: 'Close' }],
    ['late-performance data, status Open', c.getLatePerformanceData, { ...cp, status: 'Open' }],
    ['late-performance data, Planning Status Unplanned', c.getLatePerformanceData, { ...cp, status: 'Open', planningStatuses: 'UNPLANNED' }],
    ['late-performance data, Planning Status Planned', c.getLatePerformanceData, { ...cp, status: 'Open', planningStatuses: 'PLANNED' }],
    ['getLatePerformance (combined), status Open', c.getLatePerformance, { ...cp, status: 'Open' }],
    ['getLatePerformance (combined), status Close', c.getLatePerformance, { ...cp, status: 'Close' }],
    ['Shipments list (carries the OS summary)', sh.getShipments, { page: '1', limit: '20' }],
  ];

  const out = [];
  for (const [label, handler, q] of cases) {
    if (typeof handler !== 'function') { out.push({ query: label, result: 'SKIPPED', http: '-', seconds: '-', note: 'handler not found in this build' }); continue; }
    logged.length = 0;
    const r = await ask(handler, q);
    const body = r.body || {};
    const ok = r.code === 200 && body.success !== false;
    const dbReason = logged.find((m) => /does not exist|syntax error|missing FROM|ambiguous|invalid|operator|function|type/i.test(m)) || logged[logged.length - 1] || '';
    const msg = ok ? '' : (dbReason || String((body.error && (body.error.message || body.error)) || body.thrown || body.message || 'failed')).slice(0, 140);
    out.push({ query: label, result: ok ? 'ok' : 'FAILED', http: r.code, seconds: Math.round(r.ms / 100) / 10, note: msg });
  }
  console.table(out);
  const bad = out.filter((o) => o.result === 'FAILED');
  console.log(bad.length === 0 ? 'All queries answered.' : `${bad.length} query(ies) FAILED - see the note column; the server log has the SQL error (look for "column ... does not exist" or "missing FROM-clause entry").`);
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
