// Read-only: print the live DHM catalog (what KLIP is allowed to push) for each master type KLIP uses.
// Uses the DHM credentials already saved in KLIP (Integrations page); prints no secrets, writes nothing.
//
//   docker exec -i klip-backend node - < docs/scripts/diag-dhm-catalog.cjs
//   (or: git show origin/main:docs/scripts/diag-dhm-catalog.cjs | docker exec -i klip-backend node -)
const { fetchDhmCatalog } = require('/app/dist/dhm/catalog');
// Keys saved on the Integrations page live in the database. A standalone process only sees them after this load;
// without it the script falls back to process.env (the old .env keys) and gets a false 401.
const { loadIntegrationSettings } = require('/app/dist/integrations/settingsStore');

const WANT = ['commodity', 'incoterm', 'company', 'organization', 'site', 'plant', 'port_master', 'vessel', 'shipper', 'external_party'];

(async () => {
  await loadIntegrationSettings();
  const entities = await fetchDhmCatalog(true);
  console.log('Catalog slugs:', entities.map((e) => e.slug).join(', '));
  for (const e of entities) {
    if (!WANT.includes(e.slug)) continue;
    console.log(`\n=== ${e.slug} ops=${JSON.stringify(e.operations)}`);
    for (const f of e.fields || []) {
      const flags = [f.required ? 'REQUIRED' : '', f.systemGenerated ? 'system' : '', f.unique ? 'unique' : ''].filter(Boolean).join(',');
      const extra = f.referenceSlug ? ` ->${f.referenceSlug}` : '';
      const en = f.enumValues && f.enumValues.length ? ` enum=[${f.enumValues.join('|')}]` : '';
      console.log(`  ${String(f.key).padEnd(28)} ${String(f.dataType).padEnd(9)} ${flags}${extra}${en}`);
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
