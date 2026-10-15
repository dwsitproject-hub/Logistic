/**
 * Replace KLIP's Master Vessel with the vessel master sheet (services/masterVesselSheetReplace.service.ts). GENERATED from
 * replace-master-vessel-from-sheet.template.cjs by build-master-vessel-sheet-replace.cjs - edit the template, then rebuild.
 *
 * Source: __SOURCE__
 *
 * Run on the BACKEND host after a deploy that carries migration 240 and the service (SIT first):
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/replace-master-vessel-from-sheet.cjs \
 *     | docker exec -i klip-backend node -                     # DRY RUN: does everything, prints the report, rolls back
 *   ... | docker exec -i klip-backend node - --apply           # commits, only when nothing failed
 *
 * Options: --blank-clears   an empty sheet cell clears the stored value (default: an empty cell leaves it alone)
 *          --details        list every row, not only conflicts / moves / removals
 *
 * DHM columns are not touched and nothing is pushed to DHM: the DHM cutover is a separate step. A removed vessel is kept in
 * master_vessels_archive (row, SAP codes, pairs) so it can be restored by hand.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const SHEET_ROWS = __ROWS__;

async function main() {
  const apply = process.argv.includes('--apply');
  const blankClears = process.argv.includes('--blank-clears');
  const details = process.argv.includes('--details');
  const pool = dist('database/connection').default;
  const svc = dist('services/masterVesselSheetReplace.service');

  const sheet = SHEET_ROWS.map((r) => svc.parseSheetVessel(r)).filter(Boolean);
  const noName = SHEET_ROWS.filter((r) => !svc.parseSheetVessel(r)).map((r) => r.row);
  const client = await pool.connect();
  let exitCode = 0;
  try {
    await client.query('BEGIN');
    const { masters, codeHolder } = await svc.loadMasterSnapshot(client);
    const plan = svc.planSheetReplace(sheet, masters, codeHolder);
    const result = await svc.applySheetReplace(client, plan, { blankClears });

    const count = (list, key) => list.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
    const claimedIds = new Set(plan.rows.filter((r) => r.master).map((r) => r.master.id));
    const keptIds = new Set(plan.retire.filter((t) => t.action === 'keep').map((t) => t.master.id));
    const line = (s) => console.log(s);

    line(`== Master Vessel replace from sheet (${apply ? 'APPLY' : 'DRY RUN'}${blankClears ? ', blank cells clear' : ''})`);
    line(`sheet: ${sheet.length} vessels${noName.length ? `, ${noName.length} row(s) without a name skipped (rows ${noName.join(', ')})` : ''}; master vessels now: ${masters.length}`);
    line(`rows: ${JSON.stringify(count(plan.rows, 'action'))}; matched by ${JSON.stringify(count(plan.rows.filter((r) => r.matchedBy), 'matchedBy'))}`);
    line(`not in the sheet: ${JSON.stringify(count(plan.retire, 'action'))}`);
    const okPairs = plan.pairs.filter((p) => p.ok);
    const tcPairs = okPairs.filter((p) => [p.tb, p.bg].some((v) => v && v.charter === 'T/C'));
    line(`pairs: ${okPairs.length} with one tug and one barge (${tcPairs.length} with a T/C vessel), ${plan.pairs.length - okPairs.length} incomplete`);
    line(`result: ${JSON.stringify({ ...result, failed: result.failed.length })}`);

    const conflicts = plan.rows.filter((r) => r.action === 'conflict');
    if (conflicts.length) {
      line(`\n-- CONFLICTS (not loaded; fix the sheet): ${conflicts.length}`);
      for (const r of conflicts) line(`  row ${r.sheet.row} ${r.sheet.name}: ${r.reasons.join('; ')}`);
    }
    const shared = plan.rows.filter((r) => r.sharedCodes.length);
    if (shared.length) {
      line(`\n-- SAP codes listed by more than one sheet row (attached to none): ${shared.length} rows`);
      for (const r of shared) line(`  row ${r.sheet.row} ${r.sheet.name}: ${r.sharedCodes.join(', ')}`);
    }
    const fromStaying = plan.rows.flatMap((r) => r.codes.filter((c) => c.from && (claimedIds.has(c.from.id) || keptIds.has(c.from.id))).map((c) => ({ r, c })));
    if (fromStaying.length) {
      line(`\n-- SAP codes moved away from a vessel that STAYS (check these): ${fromStaying.length}`);
      for (const { r, c } of fromStaying) line(`  ${c.code}: ${c.from.vessel_name} -> row ${r.sheet.row} ${r.sheet.name}`);
    }
    const renamed = plan.rows.filter((r) => r.action === 'update' && r.master.vessel_name !== r.sheet.name);
    line(`\n-- renamed to the sheet's name: ${renamed.length}${details ? '' : ' (--details lists them)'}`);
    if (details) for (const r of renamed) line(`  ${r.master.vessel_name} -> ${r.sheet.name} [${r.matchedBy}]`);
    const removals = plan.retire.filter((t) => t.action !== 'keep');
    line(`\n-- removed (archived): ${removals.length}`);
    for (const t of removals) line(`  ${t.master.vessel_name} [${t.master.vessel_code}] ${t.action}${t.target ? ` -> ${t.target.name}` : ''}: ${t.reason}`);
    const kept = plan.retire.filter((t) => t.action === 'keep');
    if (kept.length) {
      line(`\n-- not in the sheet but KEPT: ${kept.length}`);
      for (const t of kept) line(`  ${t.master.vessel_name} [${t.master.vessel_code}]${t.master.dhm_id ? ' (DHM-linked)' : ''}: ${t.reason}`);
    }
    const badPairs = plan.pairs.filter((p) => !p.ok);
    if (badPairs.length) {
      line(`\n-- incomplete pairs (not loaded): ${badPairs.length}`);
      for (const p of badPairs) line(`  ${p.pairCode}: ${p.reason}`);
    }
    if (details) {
      line('\n-- created');
      for (const r of plan.rows.filter((x) => x.action === 'create')) line(`  row ${r.sheet.row} ${r.sheet.name}`);
    }
    if (result.failed.length) {
      line(`\n-- FAILED: ${result.failed.length}`);
      for (const f of result.failed) line(`  ${f.what}: ${f.error}`);
    }

    if (apply && result.failed.length === 0) {
      await client.query('COMMIT');
      line('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      line(apply ? '\nNOT applied: something failed (see above). Rolled back.' : '\nDry run: rolled back. Re-run with --apply to commit.');
      if (apply) exitCode = 1;
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(error);
    exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
  process.exit(exitCode);
}

main();
