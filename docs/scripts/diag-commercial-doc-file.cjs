/**
 * READ-ONLY: why does "View" say "File not found on server" for one PO? Changes nothing.
 *
 *   docker cp docs/scripts/diag-commercial-doc-file.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-commercial-doc-file.cjs <PO number>
 *
 * For each document of the PO it prints the stored path, whether the file is there, the folder that should hold it and what that folder contains
 * (one small folder only, never the whole tree: listing the share is slow), and the history rows of the PO (who uploaded / deleted / replaced).
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const { resolveUploadAbsolutePath } = require(path.join(DIST, 'utils', 'fileUpload'));

const po = process.argv[2];

(async () => {
  if (!po) {
    console.error('usage: node /app/diag-commercial-doc-file.cjs <PO number>');
    process.exitCode = 1;
    return;
  }
  const files = await pool.query(
    `SELECT id::text AS id, document_type, file_path, file_name, file_size, created_at FROM commercial_document_files
     WHERE po_number = $1 OR contract_ext_no = $1 ORDER BY created_at`,
    [po],
  );
  console.log(`\n=== commercial_document_files for ${po}: ${files.rows.length} row(s)`);
  for (const r of files.rows) {
    const abs = resolveUploadAbsolutePath(r.file_path);
    const there = fs.existsSync(abs);
    console.log(`\n- ${r.document_type}  id ${r.id}  uploaded ${new Date(r.created_at).toISOString().slice(0, 16)}  ${r.file_size ?? '?'} bytes`);
    console.log(`    stored path : ${r.file_path}`);
    console.log(`    resolved to : ${abs}`);
    console.log(`    file there  : ${there ? 'YES' : 'NO'}`);
    if (!there) {
      const dir = path.dirname(abs);
      let listing;
      try {
        listing = fs.readdirSync(dir);
      } catch (e) {
        listing = `(folder cannot be read: ${e.code || e.message})`;
      }
      console.log(`    folder      : ${dir}`);
      console.log(`    folder holds: ${Array.isArray(listing) ? (listing.length ? listing.join(' | ') : '(empty)') : listing}`);
    }
  }
  const hist = await pool.query(
    `SELECT created_at, document_type, action_type, file_path, file_name, user_name FROM commercial_document_history
     WHERE po_number = $1 OR contract_ext_no = $1 ORDER BY created_at`,
    [po],
  );
  console.log(`\n=== commercial_document_history for ${po}: ${hist.rows.length} row(s)`);
  for (const h of hist.rows) {
    console.log(`  ${new Date(h.created_at).toISOString().slice(0, 16)}  ${h.document_type}  ${h.action_type}  ${h.user_name || ''}  ${h.file_path}`);
  }
  await pool.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
