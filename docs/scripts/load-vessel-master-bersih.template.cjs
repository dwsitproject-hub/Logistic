/**
 * Load the cleaned tug (TB) and barge (BG) vessels, and the pairs they form, into KLIP's Master Vessel - and push them to DHM.
 * Source: "Vessel Cleanup (Jovin, Klip, SAP) v2.xlsx", sheet Vessel_Master_Bersih (rows "Siap", plus any held row whose "Nama final"
 * was filled in). The data is embedded below; regenerate this file with docs/scripts/build-vessel-load-script.py after the sheet changes.
 *
 * Needs migration 230 (vessel_role, vessel_pairs): deploy the backend first. Nothing here runs from the deploy script - it is a step you
 * choose to run, per environment.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/load-vessel-master-bersih.cjs \
 *     | docker exec -i klip-backend node -                      # 1. dry run: reads only, prints what would happen
 *   ... | docker exec -i klip-backend node - --apply            # 2. load into master_vessels / vessel_pairs (one transaction)
 *   ... | docker exec -i klip-backend node - --push-dhm         # 3. push the vessels in this file to DHM (after step 2)
 *   ... | docker exec -i klip-backend node - --apply --push-dhm # 2 and 3 together
 *   add --rename-existing to 2 to give the vessels that are ALREADY in the master the clean name of the sheet (the dry run lists which)
 *
 * Rules it follows
 *  - A vessel whose base name already exists in the master is REUSED: only its empty fields are filled (owner, capacity, type, heating,
 *    lambung, charter, role); nothing is overwritten - its NAME is changed only with --rename-existing.
 *  - The same vessel written twice in the file (HADI I / HADI 1) is loaded once; both spellings point at the same master row. A tug and a barge that share a base name once TB./BG. is stripped are reported as a
 *    conflict and skipped, never merged.
 *  - A SAP code is attached only when no other vessel holds it. A held code is reported and left where it is.
 *  - A vessel with no code becomes PROVISIONAL (TMP- placeholder); the SAP import promotes it when it brings the same name with a code.
 *  - Re-running is safe: vessels are matched by name, pairs by pair code.
 *  - DHM: a tug is sent with the Hub's own tug value in Vessel_Type when the Hub's enum has one, otherwise without a type. The summary
 *    says which. A TMP- placeholder is never sent as a SAP code.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const DATA = __DATA__;

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const pushDhm = argv.includes('--push-dhm');
const renameExisting = argv.includes('--rename-existing');

function show(title, rows, fmt, limit = 60) {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length})`);
  rows.slice(0, limit).forEach((r) => console.log('  ' + fmt(r)));
  if (rows.length > limit) console.log(`  ... ${rows.length - limit} more`);
}

(async () => {
  const pool = dist('database/connection').default;
  const svc = dist('services/vesselMasterLoad.service');

  const schema = await pool.query(
    `SELECT to_regclass('public.vessel_pairs') AS pairs,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'master_vessels' AND column_name = 'vessel_role') AS role`,
  );
  if (!schema.rows[0].pairs || !schema.rows[0].role) {
    console.error('Migration 230 is not applied (vessel_role / vessel_pairs missing). Deploy the backend first.');
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  let exitCode = 0;
  try {
    const plans = await svc.planVesselLoad(client, DATA);
    const by = (a) => plans.filter((p) => p.decision.action === a);
    console.log(`File: ${DATA.vessels.length} vessels (${DATA.vessels.filter((v) => v.role === 'TB').length} TB, ${DATA.vessels.filter((v) => v.role === 'BG').length} BG), ${DATA.pairs.length} pairs`);
    console.log(`Plan: ${by('create').length} to create, ${by('exists').length} already in the master (reused, empty fields filled), ${by('duplicate').length} duplicate spellings in the file (same vessel), ${by('conflict').length} conflicts (skipped)`);

    if (by('create').length <= 40) show('TO CREATE', by('create'), (p) => `${p.vessel.role} ${p.vessel.name}${p.decision.codes.length ? '  [' + p.decision.codes.join(', ') + ']' : ''}`);
    show('CONFLICTS - skipped, decide by hand', by('conflict'), (p) => `${p.vessel.role} ${p.vessel.name}: ${p.decision.reasons.join('; ')}`);
    const skipped = plans.flatMap((p) => p.decision.skippedCodes.map((s) => ({ p, ...s })));
    const twinned = plans.filter((p) => p.decision.twins && p.decision.twins.length > 0);
    show('POSSIBLE TWINS in the master (same vessel, other spelling - merge with merge-master-vessel.cjs)', twinned, (p) =>
      `${p.vessel.role} ${p.vessel.name} [${p.decision.existing.vessel_code}]  ~  ${p.decision.twins.map((t) => `"${t.vessel_name}" [${t.vessel_code}]`).join(', ')}`);
    show('DUPLICATE spellings in the file (loaded once)', by('duplicate'), (p) => `${p.vessel.role} ${p.vessel.name} = ${p.decision.duplicateOf}`);
    const renames = svc.plannedRenames(plans);
    show(renameExisting ? 'NAMES that will be changed to the clean name' : 'NAMES that --rename-existing would change to the clean name', renames, (r) => `${r.from}  ->  ${r.to}`, 30);
    show('SAP CODES left where they are (another vessel already holds them)', skipped, (s) => `${s.code} -> held by "${s.heldBy}", not given to ${s.p.vessel.name}`);
    show('Already in the master', by('exists'), (p) => `${p.vessel.role} ${p.vessel.name} = ${p.decision.existing.vessel_name} [${p.decision.existing.vessel_code}, ${p.decision.existing.code_status}${p.decision.existing.vessel_role ? ', ' + p.decision.existing.vessel_role : ''}]`, 25);
    console.log(`\nWith a SAP code: ${plans.filter((p) => p.decision.codes.length > 0).length} vessels; provisional (no code): ${plans.filter((p) => p.decision.codes.length === 0 && p.decision.action === 'create').length}`);

    let ids = new Map();
    if (!apply && !pushDhm) {
      console.log('\nDry run - nothing written. Add --apply to load, then --push-dhm to push to DHM.');
      return;
    }

    if (apply) {
      await client.query('BEGIN');
      let result;
      try {
        result = await svc.applyVesselLoad(client, DATA, plans, { renameExisting });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      ids = result.ids;
      console.log(`\nLOADED: ${result.created} created, ${result.reused} reused${renameExisting ? ` (${result.renamed} renamed)` : ''}, ${result.duplicates} duplicate spellings, ${result.conflicts} conflicts skipped, ${result.failed.length} failed.`);
      console.log(`Pairs: ${result.pairsCreated} created, ${result.pairsUpdated} updated, ${result.pairsSkipped.length} skipped.`);
      show('FAILED vessels', result.failed, (f) => `${f.name}: ${f.error}`);
      show('Pairs skipped', result.pairsSkipped, (s) => `${s.pairCode}: ${s.reason}`);
    } else {
      // push only: the vessels of this file that are already in the master with the right role
      for (const p of plans) if (p.decision.action === 'exists') ids.set(`${p.vessel.role}|${p.vessel.name}`, p.decision.existing.id);
    }

    if (pushDhm) {
      // The server loads the DHM settings saved in the Integrations menu (database) at boot and they win over .env. This is a separate
      // process, so without this it talks to DHM with the raw .env values - which can be stale or different - and every call fails.
      await dist('integrations/settingsStore').loadIntegrationSettings();
      const catalog = dist('dhm/catalog');
      try {
        await catalog.fetchDhmCatalog(true);
      } catch (e) {
        console.error(`
DHM is not reachable with the saved settings (${e && e.message ? e.message : e}). Nothing was pushed - check the DHM settings in the Integrations menu.`);
        process.exitCode = 1; // the finally below still releases the client and closes the pool
        return;
      }
      const enumValues = await catalog.getDhmVesselTypeEnumValues();
      const tugValue = (enumValues || []).find((v) => /tug/i.test(String(v)));
      console.log(`\nDHM Vessel_Type values on the Hub: ${enumValues ? enumValues.join(', ') : '(catalog not readable)'}`);
      console.log(tugValue ? `  tugs are sent as "${tugValue}"` : '  the Hub has NO tug value: tugs are pushed WITHOUT a type (ask the DHM Integrator to add one)');
      console.log(`Pushing ${new Set(ids.values()).size} vessels to DHM ...`);
      const out = await svc.pushLoadedVesselsToDhm(ids.values(), { delayMs: 150 });
      if (out.dhmDisabled) console.log('DHM is not enabled in this environment (DHM_ENABLED): nothing was pushed.');
      else {
        console.log(`DHM: ${out.attempted} attempted, ${out.ok} ok, ${out.conflicts.length} name already in DHM (linked), ${out.errors.length} errors.`);
        show('DHM conflicts (the Hub already holds that name)', out.conflicts, (c) => `${c.name} -> ${c.dhmCode || '?'}`);
        show('DHM errors', out.errors, (e) => `${e.name}: ${e.error}`);
      }
    }
  } catch (error) {
    console.error('\nFailed:', error && error.message ? error.message : error);
    exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
  if (exitCode) process.exit(exitCode);
})();
