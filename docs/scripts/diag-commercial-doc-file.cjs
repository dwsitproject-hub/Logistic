/**
 * READ-ONLY: why does "View" say "File not found on server"? Changes nothing.
 *
 *   docker cp docs/scripts/diag-commercial-doc-file.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-commercial-doc-file.cjs <PO number>          one PO: its rows, whether each file is there, what its folder holds, its history
 *   docker exec klip-backend node /app/diag-commercial-doc-file.cjs --since 2026-11-16   every document uploaded since that date: how many files are missing, and which
 *
 * Only the stored paths are checked (one stat each, and one small folder listing per PO of a missing file): never the whole tree, listing the share is slow.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const { resolveUploadAbsolutePath } = require(path.join(DIST, 'utils', 'fileUpload'));

const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
const po = sinceIdx >= 0 ? null : args[0];

function folderHolds(abs) {
  const dir = path.dirname(abs);
  try {
    const l = fs.readdirSync(dir);
    return `${dir}  holds: ${l.length ? l.join(' | ') : '(empty)'}`;
  } catch (e) {
    return `${dir}  cannot be read: ${e.code || e.message}`;
  }
}

async function bySince() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since))) {
    console.error('usage: node /app/diag-commercial-doc-file.cjs --since YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }
  const rows = await pool.query(
    `SELECT id::text AS id, contract_ext_no, po_number, document_type, file_path, file_name, created_at
     FROM commercial_document_files WHERE created_at >= $1::date ORDER BY created_at`,
    [since],
  );
  console.log(`\n=== ${rows.rows.length} document(s) uploaded since ${since}; checking each stored path (one stat each)`);
  const missing = [];
  let i = 0;
  for (const r of rows.rows) {
    i += 1;
    if (!fs.existsSync(resolveUploadAbsolutePath(r.file_path))) missing.push(r);
    if (i % 25 === 0) console.log(`  ...${i} checked, ${missing.length} missing so far`);
  }
  console.log(`\n=== RESULT: ${missing.length} missing of ${rows.rows.length}`);
  for (const r of missing) {
    console.log(`  ${new Date(r.created_at).toISOString().slice(0, 16)}  PO ${r.po_number || r.contract_ext_no}  ${r.document_type}  ${r.file_path}`);
  }
  if (missing.length) console.log(`\nFirst missing one: ${folderHolds(resolveUploadAbsolutePath(missing[0].file_path))}`);
}

async function byPo() {
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
    if (!there) console.log(`    folder      : ${folderHolds(abs)}`);
  }
  const hist = await pool.query(
    `SELECT created_at, document_type, action_type, file_path, user_name FROM commercial_document_history
     WHERE po_number = $1 OR contract_ext_no = $1 ORDER BY created_at`,
    [po],
  );
  console.log(`\n=== commercial_document_history for ${po}: ${hist.rows.length} row(s)`);
  for (const h of hist.rows) {
    console.log(`  ${new Date(h.created_at).toISOString().slice(0, 16)}  ${h.document_type}  ${h.action_type}  ${h.user_name || ''}  ${h.file_path}`);
  }
}

(async () => {
  if (!since && !po) {
    console.error('usage: node /app/diag-commercial-doc-file.cjs <PO number>   |   --since YYYY-MM-DD');
    process.exitCode = 1;
    return;
  }
  await (since ? bySince() : byPo());
  await pool.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
