/**
 * Points ONE commercial_document_files row at the file that really holds its document, when the stored path does not exist but the file is somewhere else on the share.
 *
 *   docker cp docs/scripts/fix-commercial-doc-path.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/fix-commercial-doc-path.cjs <row id> "<new stored path>"           DRY RUN: shows the row and the file, changes nothing
 *   docker exec klip-backend node /app/fix-commercial-doc-path.cjs <row id> "<new stored path>" --apply   does it
 *
 * The stored path is relative to the backend's working directory, as the other rows are: uploads/COMMERCIAL DOCS/2026/09/1641000621/SPC_Dctr_1641000621.pdf
 * (either spelling of the folder is found; the rename of COMMERCIAL DOCS rewrites it later with the rest).
 *
 * It changes file_path, file_name (to the name the file really has), file_size and, for a PDF, mime_type - nothing else, and only when the file exists at the new path.
 * It writes fix-commercial-doc-path-rollback-<time>.sql beside where it was run (docker cp it out): that SQL puts the row back exactly as it was.
 *
 * It does not look for the file and does not judge whether it is the right document: open it in Commercial Documents (View) afterwards and check.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const { resolveUploadAbsolutePath } = require(path.join(DIST, 'utils', 'fileUpload'));

const APPLY = process.argv.includes('--apply');
const [id, newPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const sqlText = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function stop(message) {
  console.error(`STOPPED: ${message}`);
  process.exitCode = 1;
}

(async () => {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !newPath) {
    return stop('usage: node /app/fix-commercial-doc-path.cjs <row id (uuid)> "<new stored path>" [--apply]');
  }
  if (!/^uploads\//.test(newPath)) return stop(`the new path must start with "uploads/" like the stored ones do: ${newPath}`);

  const found = await pool.query(
    `SELECT id::text AS id, contract_ext_no, document_type, file_path, file_name, file_size, mime_type FROM commercial_document_files WHERE id = $1`,
    [id],
  );
  const row = found.rows[0];
  if (!row) return stop(`no commercial_document_files row has id ${id}`);

  const oldAbs = resolveUploadAbsolutePath(row.file_path);
  const oldThere = fs.existsSync(oldAbs);
  const newAbs = resolveUploadAbsolutePath(newPath);
  const newThere = fs.existsSync(newAbs);
  const stat = newThere ? fs.statSync(newAbs) : null;

  console.log(`\n=== ${APPLY ? 'APPLY' : 'DRY RUN (nothing is changed)'}`);
  console.log(`   row            : ${row.id}  PO ${row.contract_ext_no}  ${row.document_type}`);
  console.log(`   now            : ${row.file_path}   (${oldThere ? 'the file IS there - nothing to fix' : 'file missing'})`);
  console.log(`                    name "${row.file_name}", ${row.file_size ?? '?'} bytes, ${row.mime_type ?? '?'}`);
  console.log(`   new path       : ${newPath}   (${newThere ? 'file found' : 'FILE NOT FOUND'})`);
  if (stat) console.log(`                    ${stat.size} bytes, modified ${stat.mtime.toISOString().slice(0, 10)}`);

  if (oldThere) return stop('the stored path already works; refusing to change the row');
  if (!newThere || !stat || !stat.isFile()) return stop('there is no file at the new path; the row is left as it is');

  const newName = path.basename(newPath);
  const newMime = /\.pdf$/i.test(newName) ? 'application/pdf' : row.mime_type;
  console.log(`   will set       : file_path = ${newPath}`);
  console.log(`                    file_name = ${newName}, file_size = ${stat.size}, mime_type = ${newMime ?? '?'}`);

  if (!APPLY) {
    console.log('\nDry run only. Run again with --apply to do it.');
    return;
  }

  const rollback = path.join(process.cwd(), `fix-commercial-doc-path-rollback-${stamp}.sql`);
  fs.writeFileSync(
    rollback,
    `UPDATE commercial_document_files SET file_path = ${sqlText(row.file_path)}, file_name = ${sqlText(row.file_name)}, file_size = ${row.file_size == null ? 'NULL' : Number(row.file_size)}, mime_type = ${sqlText(row.mime_type)} WHERE id = ${sqlText(row.id)};\n`,
  );

  const done = await pool.query(
    `UPDATE commercial_document_files
        SET file_path = $2, file_name = $3, file_size = $4, mime_type = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [row.id, newPath, newName, stat.size, newMime],
  );
  console.log(`\nrows updated: ${done.rowCount}`);
  console.log(`rollback SQL saved to ${rollback}`);
  console.log('Open the document in Commercial Documents (View and Download) and check it is the right one.');
})()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
