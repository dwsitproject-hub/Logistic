/**
 * Why did the SAP folder auto-import not pick up the newest file?  READ ONLY - writes nothing, imports nothing.
 *
 * It answers, in order, the questions that decide it:
 *   1. Is the job enabled, on what schedule, and which folder does THIS container see?
 *   2. What does the container's Original folder hold, and which file would the job pick (newest by modification time)?
 *   3. Has that file's checksum already been registered (completed = skipped on purpose)?
 *   4. Is an SAP import stuck as 'processing' / 'pending'? The job refuses to run while one is, with no age limit, so a
 *      row left behind by a restart blocks every later run - and manual uploads too.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-sap-auto-import.cjs \
 *     | docker exec -i klip-backend node -
 *
 * Then the scheduler's own lines (container log timestamps are UTC; the cron runs in Asia/Jakarta, so 06:00 WIB reads 23:00):
 *
 *   docker logs klip-backend --since 72h 2>&1 | grep -i "SAP folder auto-import"
 */
const path = require('path');
const fs = require('fs');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const paths = dist('utils/sapAutoImportPaths');
  const svc = dist('services/sapFolderAutoImport.service');

  const env = (k) => (process.env[k] === undefined ? '(unset)' : process.env[k]);
  console.log('== 1. configuration seen by this container');
  for (const k of ['SAP_AUTO_IMPORT_ENABLED', 'SAP_AUTO_IMPORT_CRON', 'SAP_AUTO_IMPORT_ROOT', 'SAP_AUTO_IMPORT_RESULTS_ROOT', 'SAP_AUTO_IMPORT_ALL_FILES']) {
    console.log(`  ${k}=${env(k)}`);
  }
  console.log(`  server time now: ${new Date().toISOString()} (UTC)`);

  const original = paths.sapAutoImportOriginalDir();
  const exists = fs.existsSync(original);
  console.log(`\n== 2. Original folder: ${original}  ${exists ? 'exists' : 'DOES NOT EXIST'}`);
  let files = [];
  if (exists) {
    const t0 = Date.now();
    const names = fs.readdirSync(original, { withFileTypes: true }).filter((e) => e.isFile() && paths.isSapAutoImportExcelFile(e.name)).map((e) => e.name);
    files = names.map((name) => {
      const st = fs.statSync(path.join(original, name));
      return { fileName: name, size: st.size, mtimeMs: st.mtimeMs };
    });
    console.log(`  ${files.length} Excel file(s); listing took ${Date.now() - t0} ms`);
    const newest = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8);
    for (const f of newest) console.log(`    ${new Date(f.mtimeMs).toISOString()}  ${String(f.size).padStart(10)}  ${f.fileName}`);
    const picked = svc.pickLatestOriginalFile(files)[0];
    console.log(`  the job would pick: ${picked ? picked.fileName : '(nothing)'}`);

    if (picked) {
      const sha = await paths.sha256File(path.join(original, picked.fileName));
      const reg = await pool.query(`SELECT file_name, status, processed_at, import_id, error_message FROM sap_auto_import_files WHERE sha256 = $1`, [sha]);
      console.log(`\n== 3. checksum of that file ${sha.slice(0, 12)}...`);
      if (reg.rows.length === 0) console.log('  not registered: it has never been imported, so the job WOULD process it');
      else console.log(`  registered: status=${reg.rows[0].status} at ${reg.rows[0].processed_at && new Date(reg.rows[0].processed_at).toISOString()} (${reg.rows[0].file_name})${reg.rows[0].status === 'completed' ? '  -> skipped on purpose (same content already imported)' : ''}`);
    }
  }

  const recent = await pool.query(`SELECT file_name, status, processed_at, error_message FROM sap_auto_import_files ORDER BY processed_at DESC NULLS LAST LIMIT 6`);
  console.log('\n   last registered files:');
  for (const r of recent.rows) console.log(`    ${r.processed_at && new Date(r.processed_at).toISOString()}  ${r.status.padEnd(9)} ${r.file_name}${r.error_message ? '  !! ' + String(r.error_message).slice(0, 100) : ''}`);

  console.log('\n== 4. imports the job treats as still running (status processing / pending)');
  const live = await pool.query(
    `SELECT id::text, status, import_timestamp, total_records, COALESCE(processed_records,0) AS done,
            ROUND(EXTRACT(EPOCH FROM (NOW() - import_timestamp)) / 60) AS age_min
       FROM sap_data_imports WHERE status IN ('processing','pending') ORDER BY import_timestamp DESC NULLS LAST`,
  );
  if (live.rows.length === 0) console.log('  none');
  for (const r of live.rows) {
    console.log(`  ${r.id}  ${r.status}  started ${r.import_timestamp && new Date(r.import_timestamp).toISOString()}  ${r.done}/${r.total_records ?? '?'}  age ${r.age_min} min${Number(r.age_min) > 120 ? '   <== STUCK: nothing runs while this row exists' : ''}`);
  }

  const last = await pool.query(`SELECT id::text, status, import_timestamp, total_records, COALESCE(processed_records,0) AS done FROM sap_data_imports ORDER BY import_timestamp DESC NULLS LAST LIMIT 5`);
  console.log('\n   last imports (any source):');
  for (const r of last.rows) console.log(`    ${r.import_timestamp && new Date(r.import_timestamp).toISOString()}  ${r.status.padEnd(10)} ${r.done}/${r.total_records ?? '?'}  ${r.id}`);

  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
