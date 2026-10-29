/**
 * Renames the Commercial Documents folder on the upload root (the Synology share in production) from `COMMERCIAL DOCS` to `commercial-docs`, and rewrites the stored paths.
 *
 *   docker cp docs/scripts/rename-commercial-docs-folder.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/rename-commercial-docs-folder.cjs            DRY RUN: what it would do, changes nothing
 *   docker exec klip-backend node /app/rename-commercial-docs-folder.cjs --apply    does it (makes its OWN backup tables first)
 *
 * RUN IT AFTER the backend with the new folder name is deployed (that is what makes new uploads go to commercial-docs, and lets a stored path be found under either name
 * in between), and with no one browsing the folder in Explorer: a folder that is open on another machine cannot be renamed on an SMB share, and the script then stops
 * before touching the database.
 *
 * ORDER (each step leaves every document readable): 1. backup tables of commercial_document_files / commercial_document_history; 2. the FILES move - one rename of the
 * folder when commercial-docs does not exist yet, else a merge that never overwrites (new uploads may have created it); 3. the stored PATHS are rewritten, only for a file
 * that is really at its new place, in one transaction. It writes commercial-docs-rename-rollback-<time>.sql (the path updates) beside where it was run - docker cp it out.
 * To go back: rename the folder back and run that SQL; the code reads either spelling meanwhile.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const svc = require(path.join(DIST, 'services', 'commercialDocsFolderRename.service'));
const { getUploadRootDir } = require(path.join(DIST, 'utils', 'fileUpload'));

const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const absOf = (stored) => (path.isAbsolute(stored) ? stored : path.resolve(process.cwd(), stored));
const here = (stored) => fs.existsSync(absOf(stored));

const started = Date.now();
const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
const say = (msg) => console.log(`[${secs()}] ${msg}`);

/**
 * Every file under dir. On an SMB share a read is slow and the script prints nothing until the walk is over, so `label` turns on a line per folder two levels down
 * (the year/month folders) and a running count: a walk that is slow is told from one that is stuck.
 */
function walk(dir, label, depth = 0, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (label && depth === 1) say(`${label}: reading ${path.relative(path.dirname(dir), p)} (${out.length} files so far)`);
      walk(p, label, depth + 1, out);
    } else out.push(p);
  }
  return out;
}

async function rowsOf(table) {
  try {
    return (await pool.query(`SELECT id::text AS id, file_path FROM ${table} WHERE file_path ILIKE '%COMMERCIAL DOCS%'`)).rows;
  } catch (e) {
    console.log(`   ${table}: not readable (${e.message}) - skipped`);
    return null;
  }
}

(async () => {
  const root = getUploadRootDir();
  const { oldDir, newDir } = svc.commercialDocsDirs(root);
  say(`upload root ${root}`);
  const oldExists = fs.existsSync(oldDir);
  const newExists = fs.existsSync(newDir);
  /*
   * Reading the folder tree is only needed to merge into a commercial-docs that already exists (and to see which names are taken). Without one the folder is renamed
   * whole in a single step that reads nothing, and a walk over an SMB share costs ~0.2 s per entry: 30+ minutes for ~10,000 files, for a number nobody acts on.
   * The rows check below (is the file at its old path) already says which documents are really there.
   */
  const oldFiles = oldExists && newExists ? walk(oldDir, 'COMMERCIAL DOCS') : [];
  if (oldExists && newExists) say(`read ${oldFiles.length} files`);
  const clash = newExists ? oldFiles.filter((f) => fs.existsSync(path.join(newDir, path.relative(oldDir, f)))) : [];
  console.log('');
  console.log(`=== ${APPLY ? 'APPLY' : 'DRY RUN (nothing is changed)'}`);
  console.log(`   upload root          : ${root}`);
  console.log(`   COMMERCIAL DOCS      : ${oldExists ? (newExists ? `exists, ${oldFiles.length} files` : 'exists (files not counted: it is renamed whole, nothing is read)') : 'does not exist'}`);
  console.log(`   commercial-docs      : ${newExists ? `exists (${walk(newDir, 'commercial-docs').length} files): the two will be MERGED` : 'does not exist: the folder will be renamed in one step'}`);
  console.log(`   names taken in both  : ${clash.length}${clash.length ? ' (left where they are, listed after)' : ''}`);

  const per = {};
  for (const table of svc.COMMERCIAL_DOCS_PATH_TABLES) {
    const rows = await rowsOf(table);
    if (!rows) continue;
    say(`${table}: ${rows.length} rows with the old path; checking each file ...`);
    const exact = rows.filter((r) => svc.toNewCommercialDocsStoredPath(r.file_path)).length;
    let checked = 0;
    const present = rows.filter((r) => {
      checked += 1;
      if (checked % 1000 === 0) say(`${table}: checked ${checked} of ${rows.length}`);
      return here(r.file_path);
    }).length;
    per[table] = { rows_with_old_path: rows.length, rewritable: exact, file_present_at_old_path: present };
  }
  console.table(per);

  if (!APPLY) {
    if (clash.length) {
      console.log('names taken in both folders (first 15):');
      for (const f of clash.slice(0, 15)) console.log('   ' + path.relative(oldDir, f));
    }
    console.log('\nDry run only. Make sure the backend with the new folder name is deployed and nobody has the folder open, then run again with --apply.');
    await pool.end();
    return;
  }

  // 1. backups, made here so there is nothing to remember
  const backups = [];
  for (const table of Object.keys(per)) {
    const name = `${table}_bak_${stamp}`;
    await pool.query(`CREATE TABLE ${name} AS SELECT * FROM ${table}`);
    const n = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${name}`)).rows[0].n);
    backups.push(`${name} (${n} rows)`);
  }
  console.log(`\nbackups: ${backups.join(', ') || 'none'}`);

  // 2. the files
  let tree;
  try {
    tree = svc.moveCommercialDocsTree(root);
  } catch (e) {
    console.error(`\nSTOPPED, the database was not touched: the folder could not be moved: ${e.message}`);
    console.error('If it says EBUSY / EPERM / EACCES, someone has the folder open (Explorer on another machine); close it and run again.');
    await pool.end();
    process.exit(1);
  }
  console.log(tree.nothing ? 'files: no COMMERCIAL DOCS folder, nothing to move' : tree.renamedWhole ? 'files: COMMERCIAL DOCS renamed to commercial-docs in one step' : `files: merged into commercial-docs, ${tree.moved} moved, ${tree.collisions.length} left behind`);
  for (const c of tree.collisions.slice(0, 25)) console.log(`   LEFT BEHIND (name taken): ${c}`);

  // 3. the paths
  const allUpdates = [];
  const allMissing = [];
  for (const table of Object.keys(per)) {
    const rows = await rowsOf(table);
    const { updates, missing } = svc.planPathUpdates(table, rows || [], here);
    if (updates.length) {
      const client = await pool.connect();
      try {
        const n = await svc.applyPathUpdates(client, updates);
        console.log(`paths: ${table}: ${n} rewritten`);
        allUpdates.push(...updates);
      } finally {
        client.release();
      }
    } else {
      console.log(`paths: ${table}: nothing to rewrite`);
    }
    for (const m of missing) allMissing.push(`${table} ${m.id} ${m.file_path}`);
  }
  if (allMissing.length) {
    console.log(`\n${allMissing.length} rows still point at the old name because their file is not at the new place (left alone; the code reads either spelling) - first 25:`);
    for (const m of allMissing.slice(0, 25)) console.log('   ' + m);
  }

  const rb = path.join(process.cwd(), `commercial-docs-rename-rollback-${stamp}.sql`);
  fs.writeFileSync(rb, svc.rollbackSqlForPathUpdates(allUpdates).join('\n') + '\n');
  console.log(`\nrollback SQL (the path updates) saved to ${rb}`);
  console.log('Open a few documents in Commercial Documents (View and Download) to see they still open.');
  await pool.end();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
