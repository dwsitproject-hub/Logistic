/**
 * Files documents stored in the wrong folder where they belong, on the upload root (the Synology share in production):
 *
 *   shipment Contract / SI / BL / SLD / SDD  ->  documents/shipment/<contract|si|bl|sld|sdd>/<STO number, else operation id>/
 *   documents of a trucking operation      ->  documents/trucking/<operation id>/
 *
 *   docker cp docs/scripts/migrate-documents-to-folders.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/migrate-documents-to-folders.cjs                       DRY RUN: the plan, changes nothing
 *   docker exec klip-backend node /app/migrate-documents-to-folders.cjs --apply --backup-table documents_bak_20261029 [--limit 20] [--only shipment|trucking]
 *
 * WHY. Every client appends `file` before `document_type` / `shipment_id`, so multer's destination callback saw an empty body and wrote to the upload root; the rename
 * to OP-...-bl-ddmmyy-user then happened in that same folder. Trucking uploads had no folder at all. New uploads are fixed in the backend (document.controller.ts);
 * this moves the ones already on the share.
 *
 * WHAT IT CHANGES, and only that: the FOLDER of the file, and documents.file_path to match. The file keeps its name, documents.file_name is untouched, and a download by
 * id (what the JPS links use) keeps working. A row whose file is missing, whose target name is taken, or that has nothing to file it under is listed and left alone.
 * Each row is its own step: the file is moved, then file_path is updated with a guard on the old value; if that fails the file goes back.
 *
 * --apply REFUSES unless --backup-table names a table that exists and holds at least as many rows as documents (CREATE TABLE <name> AS SELECT * FROM documents;).
 * It writes documents-move-plan-<time>.csv and, after --apply, documents-move-rollback-<time>.sql beside where it was run (inside the container: /app) - docker cp them out.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const { SELECT_DOCUMENTS_TO_FILE_SQL, planDocumentMoves, applyDocumentMoves, rollbackSqlForMoves } = require(path.join(DIST, 'services', 'documentFolderMigration.service'));

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BACKUP = flag('--backup-table');
const LIMIT = flag('--limit') ? Number(flag('--limit')) : 0;
const ONLY = flag('--only');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

(async () => {
  const rows = (await pool.query(SELECT_DOCUMENTS_TO_FILE_SQL)).rows;
  let plans = planDocumentMoves(rows);
  if (ONLY) plans = plans.filter((p) => p.kind === ONLY);

  const by = {};
  for (const p of plans) {
    const k = `${p.kind} / ${p.documentType || '-'}`;
    by[k] = by[k] || { move: 0, already_in_place: 0, missing: 0, collision: 0, no_target: 0 };
    by[k][p.action] += 1;
  }
  console.log('');
  console.log(`=== ${APPLY ? 'APPLY' : 'DRY RUN (nothing is changed)'}: ${plans.length} documents looked at${ONLY ? ` (only ${ONLY})` : ''}`);
  console.table(by);

  const file = path.join(process.cwd(), `documents-move-plan-${stamp}.csv`);
  fs.writeFileSync(
    file,
    ['id,kind,document_type,action,from,to', ...plans.map((p) => [p.id, p.kind, p.documentType, p.action, p.fromStored, p.toStored].map(csv).join(','))].join('\n') + '\n',
  );
  console.log(`plan written to ${file}`);

  const show = (action, title, n = 25) => {
    const list = plans.filter((p) => p.action === action);
    if (!list.length) return;
    console.log(`\n=== ${title} (${list.length})${list.length > n ? `, first ${n}` : ''}`);
    for (const p of list.slice(0, n)) console.log(`   ${p.id}  ${p.kind}/${p.documentType || '-'}  ${p.fromStored}${p.toStored && action !== 'no_target' ? `  ->  ${p.toStored}` : ''}`);
  };
  show('move', 'WILL MOVE', 10);
  show('missing', 'FILE NOT FOUND on disk (left alone: the row points at nothing)');
  show('collision', 'TARGET NAME ALREADY TAKEN (left alone: decide by hand)');
  show('no_target', 'NOTHING TO FILE THEM UNDER (left alone)');

  if (!APPLY) {
    console.log('\nDry run only. Back up the table, then run again with --apply --backup-table <name>.');
    await pool.end();
    return;
  }

  // the guard: a backup of the table must exist before any file moves
  if (!BACKUP || !/^[a-z0-9_]+$/i.test(BACKUP)) {
    console.error('\nREFUSED: --apply needs --backup-table <name> (letters, digits, underscore): CREATE TABLE <name> AS SELECT * FROM documents;');
    await pool.end();
    process.exit(2);
  }
  try {
    const have = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${BACKUP}`)).rows[0].n);
    const now = Number((await pool.query('SELECT COUNT(*)::int AS n FROM documents')).rows[0].n);
    if (have < now) {
      console.error(`\nREFUSED: ${BACKUP} holds ${have} rows but documents holds ${now}. Make a fresh backup.`);
      await pool.end();
      process.exit(2);
    }
    console.log(`\nbackup ${BACKUP}: ${have} rows (documents: ${now}) - ok`);
  } catch (e) {
    console.error(`\nREFUSED: cannot read backup table ${BACKUP}: ${e.message}`);
    await pool.end();
    process.exit(2);
  }

  const out = await applyDocumentMoves(plans, pool, { limit: LIMIT });
  console.log(`\nmoved ${out.moved.length}, failed ${out.failed.length}`);
  for (const f of out.failed) console.log(`   FAILED ${f.id}: ${f.reason}`);
  const rb = path.join(process.cwd(), `documents-move-rollback-${stamp}.sql`);
  fs.writeFileSync(rb, rollbackSqlForMoves(out.moved).join('\n') + '\n');
  console.log(`rollback SQL (file_path only; the files themselves go back with the pairs in the plan CSV swapped) saved to ${rb}`);
  await pool.end();
  if (out.failed.length) process.exit(1);
})().catch((e) => {
  console.error('FAILED, nothing further was changed:', e.message);
  process.exit(1);
});
