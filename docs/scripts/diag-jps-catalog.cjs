/*
 * READ-ONLY: what the JPS partner API says about itself RIGHT NOW (GET /catalog and GET /catalog/{entity}), set beside what KLIP sends and knows.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-jps-catalog.cjs | docker exec -i klip-backend node -
 *
 * It makes only GET calls through KLIP's own JPS client (the base URL and key saved in Integrations > JPS), so each call also shows in Integrations > JPS > History.
 * It sends nothing to JPS and writes nothing to the database or to a file. The full catalog is printed at the end between two marker lines, so it can be copied.
 *
 *  1. api_version and the entity list.
 *  2. shipping-instruction and webhook: every field (type, required, patchable, system generated, how many enum values).
 *  3. Against KLIP: the status values JPS lists vs the ones KLIP knows, the required POST fields vs the keys of a payload KLIP really builds (the first STO that is
 *     owed to JPS, when there is one), and the keys KLIP sends that the catalog does not list (JPS would answer 400 or ignore them).
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

// The statuses KLIP handles (jps/types.ts). Kept here as plain text so the script does not depend on a type that is erased at build time.
const KLIP_KNOWN_STATUSES = ['Pending', 'Approved', 'Rejected', 'Deleted', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Sailed Off', 'Sailed'];

// jpsRequest already hands back the envelope's data.
const unwrap = (d) => d;

async function get(jpsRequest, url) {
  const res = await jpsRequest({ method: 'GET', url }, { requireEnabled: false });
  if (!res.ok) return { ok: false, status: res.status, code: res.code, message: res.message };
  return { ok: true, status: res.status, data: unwrap(res.data) };
}

const fieldRow = (f) => ({
  key: f.key,
  type: f.type,
  required: f.required === true ? 'YES' : '',
  patchable: f.patchable === true ? 'yes' : '',
  system: f.systemGenerated === true ? 'system' : '',
  maxLength: f.maxLength ?? '',
  enums: Array.isArray(f.enumValues) ? f.enumValues.length : '',
  children: Array.isArray(f.items) ? f.items.map((c) => c.key).join(',') : '',
});

(async () => {
  const { jpsRequest } = load('jps/client');
  const { jpsBaseUrl, jpsApiKey, isJpsEnabled, jpsEnabledPortNames } = load('jps/config');
  let host = '(not set)';
  try { host = new URL(jpsBaseUrl()).host; } catch { /* keep */ }
  console.log(`JPS enabled: ${isJpsEnabled()}   host: ${host}   api key set: ${Boolean(jpsApiKey())}\n`);

  const list = await get(jpsRequest, '/catalog');
  if (!list.ok) {
    console.log('GET /catalog failed:', list.status, list.code, list.message);
    process.exit(1);
  }
  const listing = list.data || {};
  console.log(`--- GET /catalog   api_version: ${listing.api_version}   count: ${listing.count}`);
  const entities = Array.isArray(listing.entities) ? listing.entities : [];
  console.table(entities.map((e) => ({ slug: e.slug, path: e.path ?? '-', methods: (e.methods || []).join(','), fields: e.fieldCount })));

  const full = { list: listing, entities: {} };
  for (const e of entities) {
    const one = await get(jpsRequest, `/catalog/${e.slug}`);
    full.entities[e.slug] = one.ok ? one.data : { error: one };
  }

  for (const slug of ['shipping-instruction', 'webhook']) {
    const ent = full.entities[slug];
    if (!ent || ent.error) { console.log(`\n--- ${slug}: not readable`, ent && ent.error); continue; }
    console.log(`\n--- ${slug}   ${ent.path ?? ''}   ${(ent.methods || []).join(',')}`);
    console.table((ent.fields || []).map(fieldRow));
    if (Array.isArray(ent.fields)) {
      for (const f of ent.fields) {
        if (Array.isArray(f.items) && f.items.length) console.log(`  ${f.key}[]:`, f.items.map((c) => `${c.key}${c.required ? '*' : ''}:${c.type}`).join('  '));
      }
    }
  }

  // Against KLIP
  const si = full.entities['shipping-instruction'];
  if (si && !si.error && Array.isArray(si.fields)) {
    console.log('\n--- against KLIP');
    const statusField = si.fields.find((f) => f.key === 'status');
    const jpsStatuses = Array.isArray(statusField && statusField.enumValues) ? statusField.enumValues : [];
    console.log('status values JPS lists   :', jpsStatuses.join(' | ') || '(none listed)');
    console.log('JPS statuses KLIP lacks   :', jpsStatuses.filter((s) => !KLIP_KNOWN_STATUSES.includes(s)).join(' | ') || '(none)');
    console.log('KLIP statuses JPS dropped :', KLIP_KNOWN_STATUSES.filter((s) => !jpsStatuses.includes(s)).join(' | ') || '(none)');

    const required = si.fields.filter((f) => f.required === true && f.systemGenerated !== true).map((f) => f.key);
    const postable = new Set(si.fields.filter((f) => f.systemGenerated !== true).map((f) => f.key));
    console.log('required POST fields      :', required.join(', '));
    if (Array.isArray(si.legacyFieldsRejected) || (si.fields.find((f) => f.key === 'legacyFieldsRejected'))) {
      const lf = si.fields.find((f) => f.key === 'legacyFieldsRejected');
      console.log('legacyFieldsRejected      :', JSON.stringify(si.legacyFieldsRejected ?? (lf && lf.description) ?? ''));
    }

    try {
      const { findEligibleStos } = load('jps/eligibility');
      const { buildJpsSubmitPayload } = load('jps/mapper');
      const ports = jpsEnabledPortNames();
      const eligible = ports.length ? await findEligibleStos(ports, 20, {}) : [];
      let payload = null;
      for (const sto of eligible) {
        const built = buildJpsSubmitPayload({ ...sto, revision: 1, requested_by: null });
        if (built.payload) { payload = built.payload; break; }
      }
      if (!payload) {
        console.log('no STO owed to JPS builds a payload right now (ports on: ' + (ports.join(', ') || 'none') + '), so the payload comparison is skipped.');
      } else {
        const sent = Object.keys(payload);
        console.log('keys KLIP sends           :', sent.join(', '));
        console.log('required but NOT sent     :', required.filter((k) => !sent.includes(k)).join(', ') || '(none)');
        console.log('sent but NOT in catalog   :', sent.filter((k) => !postable.has(k)).join(', ') || '(none)');
        const cargoField = si.fields.find((f) => f.key === 'cargo');
        const cargoKeys = (cargoField && Array.isArray(cargoField.items) ? cargoField.items : []).map((c) => c.key);
        const cargoSentKeys = Array.isArray(payload.cargo) && payload.cargo[0] ? Object.keys(payload.cargo[0]) : [];
        console.log('cargo[] keys KLIP sends   :', cargoSentKeys.join(', '));
        console.log('cargo[] sent, not listed  :', cargoSentKeys.filter((k) => !cargoKeys.includes(k)).join(', ') || '(none)');
        console.log('cargo[] required, not sent:', (cargoField && cargoField.items ? cargoField.items.filter((c) => c.required && !cargoSentKeys.includes(c.key)).map((c) => c.key) : []).join(', ') || '(none)');
      }
    } catch (err) {
      console.log('payload comparison skipped:', err && err.message ? err.message : err);
    }
  }

  console.log('\n=== FULL CATALOG JSON (copy from here) ===');
  console.log(JSON.stringify(full, null, 2));
  console.log('=== END ===');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
