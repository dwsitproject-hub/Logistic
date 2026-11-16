/*
 * READ-ONLY: why does Master Product hold only a handful of rows when DHM's commodity catalog is thousands (SIT: 3,405)?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-dhm-commodity-pull.cjs | docker exec -i klip-backend node -
 *
 * It answers, in order:
 *  1. What `products` holds: rows, how many came FROM DHM (dhm_id), how many carry material_code, how many KLIP made itself.
 *  2. Where the DHM pull stands: the cursor kept per entity (dhm_sync_state) - a commodity cursor that exists with few rows means the pull ran and wrote nothing.
 *  3. What DHM says: is `commodity` in its catalog for this key (read allowed?), and the first page of /v1/sync/commodity (how many records, whether they carry
 *     material_code and a type, and the first two names).
 * Only GET calls and SELECTs. Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { query } = load('database/connection');
  const { isDhmEnabled, dhmBaseUrl } = load('dhm/config');
  let host = '(not set)';
  try { host = new URL(dhmBaseUrl()).host; } catch { /* keep */ }
  console.log(`DHM enabled: ${isDhmEnabled()}   host: ${host}\n`);

  const p = await query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE dhm_id IS NOT NULL)::int AS from_dhm,
           count(*) FILTER (WHERE dhm_id IS NULL)::int AS klip_made,
           count(*) FILTER (WHERE NULLIF(trim(material_code), '') IS NOT NULL)::int AS with_material_code,
           count(*) FILTER (WHERE dhm_payload IS NOT NULL)::int AS with_payload,
           min(created_at)::date AS oldest, max(created_at)::date AS newest
      FROM products`);
  console.log('--- products'); console.table(p.rows);

  const s = await query(`SELECT entity, (cursor IS NOT NULL) AS has_cursor, last_updated_at, updated_at FROM dhm_sync_state ORDER BY entity`);
  console.log('--- dhm_sync_state (the pull cursor per entity)'); console.table(s.rows);

  if (!isDhmEnabled()) { console.log('DHM is not enabled here, so DHM itself is not asked.'); process.exit(0); }
  const { dhmRequest } = load('dhm/client');

  const cat = await dhmRequest({ method: 'GET', url: '/v1/catalog' });
  const entities = Array.isArray(cat.data && cat.data.entities) ? cat.data.entities : [];
  const commodity = entities.find((e) => e.slug === 'commodity');
  console.log(`--- GET /v1/catalog: HTTP ${cat.status}, ${entities.length} entities; commodity listed: ${Boolean(commodity)}`);
  if (commodity) {
    console.log('    commodity operations:', JSON.stringify(commodity.operations || {}));
    console.log('    commodity fields    :', (commodity.fields || []).map((f) => f.key + (f.required ? '*' : '')).join(', '));
  } else {
    console.log('    slugs the key can see:', entities.map((e) => e.slug).join(', '));
  }

  const page = await dhmRequest({ method: 'GET', url: '/v1/sync/commodity?limit=100' });
  const records = Array.isArray(page.data && page.data.records) ? page.data.records : [];
  console.log(`\n--- GET /v1/sync/commodity?limit=100: HTTP ${page.status}, ${records.length} records on page 1, hasMore: ${Boolean(page.data && page.data.hasMore)}`);
  const data = (r) => (r && (r.data || r.fields)) || r || {};
  const pick = (r, k) => { const d = data(r); return d[k] ?? d[k.toLowerCase()] ?? null; };
  console.log('    with material_code on page 1:', records.filter((r) => pick(r, 'material_code') || pick(r, 'Material_Code')).length);
  console.log('    with a type on page 1       :', records.filter((r) => pick(r, 'type') || pick(r, 'Type') || pick(r, 'commodity_type')).length);
  for (const r of records.slice(0, 2)) console.log('    sample:', JSON.stringify(r).slice(0, 420));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
