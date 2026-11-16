/*
 * READ-ONLY: which STOs owed to JPS would be sent or held right now, and does every cargo line carry a cargo_hub_code that JPS actually lists?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-jps-material-codes.cjs | docker exec -i klip-backend node -
 *
 * It builds the payloads the sweep would build for every STO owed to JPS (nothing is sent, nothing is written) and reports what holds and why.
 * The only calls it makes to JPS are two reads (GET /catalog/port and GET /catalog/cargo-type); they show in Integrations > JPS > History like any other.
 *
 * Beyond the .ts diag of the same name, it sets each cargo line's code against the commodity codes JPS lists now (cargo-type enumValues), so a code JPS does
 * not know - a refusal waiting to happen - shows here instead of after a submit.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const call = (mod, name, fallback) => (typeof mod[name] === 'function' ? mod[name]() : fallback);

(async () => {
  const { query } = load('database/connection');
  const { findEligibleStos } = load('jps/eligibility');
  const { buildJpsSubmitPayload } = load('jps/mapper');
  const cfg = load('jps/config');
  const { jpsRequest } = load('jps/client');

  // 1. Configuration and the link to JPS
  let host = '(not set)';
  try { host = new URL(cfg.jpsBaseUrl()).host; } catch { /* keep the placeholder */ }
  console.log('--- configuration');
  console.table([{
    enabled: cfg.isJpsEnabled(),
    auto_submit: call(cfg, 'jpsAutoSubmit', 'n/a'),
    retry_failed: call(cfg, 'jpsRetryFailed', 'n/a'),
    sweep_cron: call(cfg, 'jpsSweepCron', 'n/a'),
    base_url_host: host,
    api_key_set: Boolean(cfg.jpsApiKey()),
  }]);

  // 2. What JPS lists as cargo codes right now
  console.log('--- live read of the JPS cargo-type catalog (GET /catalog/cargo-type)');
  const ct = await jpsRequest({ method: 'GET', url: '/catalog/cargo-type' }, { requireEnabled: false });
  let jpsCodes = null;
  if (ct.ok && ct.data && Array.isArray(ct.data.fields)) {
    const hub = ct.data.fields.find((f) => f.key === 'hub_code');
    if (hub && Array.isArray(hub.enumValues)) jpsCodes = new Set(hub.enumValues.map((c) => String(c).trim().toUpperCase()));
  }
  console.table([ct.ok
    ? { ok: true, status: ct.status, codes_listed: jpsCodes ? jpsCodes.size : '? (no enumValues)', rows_without_hub_code: Array.isArray(ct.data.referenceRows) ? ct.data.referenceRows.filter((r) => !r.hub_code).length : '?' }
    : { ok: false, status: ct.status, code: ct.code, message: String(ct.message).slice(0, 120) }]);

  console.log('--- JPS call history, last 7 days (kind / status / result)');
  console.table((await query(`SELECT kind, response_status, ok, COALESCE(error_code,'-') AS error_code, LEFT(COALESCE(error_message,'-'), 70) AS error_message, COUNT(*)::int AS n, MAX(created_at)::timestamp(0) AS last_at FROM jps_api_calls WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY 1,2,3,4,5 ORDER BY n DESC LIMIT 15`)).rows);

  // 3. Which STOs would go, and does the cargo code resolve
  const ports = cfg.jpsEnabledPortNames();
  console.log('JPS enabled:', cfg.isJpsEnabled(), '| ports switched on:', ports.join(', ') || '(none)');
  if (ports.length === 0) {
    console.log('No port is switched on, so nothing is eligible. Switch one on in Integrations > JPS > Ports, or stop here.');
    process.exit(0);
  }
  const eligible = await findEligibleStos(ports, 5000, {});
  console.log('STOs owed to JPS (not submitted yet):', eligible.length);

  let ok = 0;
  const reasons = new Map();
  const missingMaterial = new Map();
  const unknownToJps = new Map();
  let lines = 0;
  let linesWithCode = 0;
  let linesUnknownToJps = 0;
  const stoWithUnknown = new Set();
  const samples = [];

  for (const sto of eligible) {
    const built = buildJpsSubmitPayload({ ...sto, revision: 1, requested_by: null });
    if (built.payload) ok += 1;
    for (const p of built.problems) {
      const key = p.replace(/"[^"]*"/g, '"…"').replace(/\d{4}-\d{2}-\d{2}.*/, '…').slice(0, 110);
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
    for (const line of sto.cargo) {
      lines += 1;
      const code = String(line.product_hub_code || '').trim();
      if (code) {
        linesWithCode += 1;
        if (jpsCodes && !jpsCodes.has(code.toUpperCase())) {
          linesUnknownToJps += 1;
          stoWithUnknown.add(sto.sto_key);
          const k = `${code} | ${line.product || '-'} | material ${String(line.material_code || '').trim() || '-'}`;
          unknownToJps.set(k, (unknownToJps.get(k) || 0) + 1);
        }
      } else {
        const m = String(line.material_code || '').trim() || '(no material_code on the contract)';
        const k = `${m} | ${line.product || '-'}`;
        missingMaterial.set(k, (missingMaterial.get(k) || 0) + 1);
      }
      if (samples.length < 10 && code) {
        samples.push({ sto: String(sto.sto_key).slice(0, 24), product: line.product, material_code: line.material_code, cargo_hub_code: code, jps_lists_it: jpsCodes ? jpsCodes.has(code.toUpperCase()) : '?' });
      }
    }
  }

  console.log(`\nPayload would be built for ${ok} of ${eligible.length} STOs (the rest are held with a reason; nothing was sent).`);
  console.log(`Cargo lines: ${lines}; with a cargo_hub_code: ${linesWithCode}; whose code JPS does NOT list: ${jpsCodes ? linesUnknownToJps : 'n/a'} (in ${stoWithUnknown.size} STOs)`);
  console.log('\n--- why STOs are held (a reason can repeat across STOs)');
  console.table([...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([reason, n]) => ({ reason, n })));
  console.log('--- cargo lines with NO cargo_hub_code, by material | product');
  console.table([...missingMaterial.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, n]) => ({ material_and_product: key, lines: n })));
  console.log('--- cargo lines whose code JPS does not list (JPS would refuse them), by code | product | material');
  console.table([...unknownToJps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, n]) => ({ code_product_material: key, lines: n })));
  console.log('--- samples that resolve');
  console.table(samples);

  const states = await query(`SELECT state, COUNT(*)::int AS n FROM jps_shipping_instructions GROUP BY 1 ORDER BY n DESC`);
  console.log('--- instructions already recorded, by state');
  console.table(states.rows);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
