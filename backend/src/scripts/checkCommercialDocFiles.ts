/**
 * READ-ONLY integrity check: is the file of every recent Commercial Document really on the disk?
 *
 *   docker exec klip-backend node dist/scripts/checkCommercialDocFiles.js --days 2     documents recorded in the last 2 days (the daily check)
 *   docker exec klip-backend node dist/scripts/checkCommercialDocFiles.js --since 2026-11-12
 *   docker exec klip-backend node dist/scripts/checkCommercialDocFiles.js --po 1001033448
 *
 * Exit code 0 = every file is there, 1 = at least one is missing (or the check could not run), so a cron job or a deploy step can act on it.
 * Only the stored paths are checked (one stat each); the whole tree is never listed, because listing the share is slow.
 * It also reports whether the upload folder is the share (the marker file), the thing whose absence made every document "missing" on 2026-11-12 and 2026-11-17.
 */
import fs from 'fs';
import pool from '../database/connection';
import { resolveUploadAbsolutePath } from '../utils/fileUpload';
import { UPLOADS_MARKER_FILE, uploadsMarkerRequired, uploadsRootProblem } from '../utils/uploadsGuard';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] ?? '') : null;
}

async function main(): Promise<number> {
  const days = arg('--days');
  const since = arg('--since');
  const po = arg('--po');

  if (uploadsMarkerRequired()) {
    const problem = uploadsRootProblem();
    console.log(problem ? `UPLOAD FOLDER NOT ON THE SHARE: ${problem}` : `upload folder is the share (${UPLOADS_MARKER_FILE} found)`);
  } else {
    console.log('upload marker check is off (UPLOADS_REQUIRE_MARKER is not true)');
  }

  let sql = '';
  let params: unknown[] = [];
  if (po) {
    sql = `SELECT id::text AS id, COALESCE(po_number, contract_ext_no) AS po, document_type, file_path, created_at
           FROM commercial_document_files WHERE po_number = $1 OR contract_ext_no = $1 ORDER BY created_at`;
    params = [po];
  } else if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    sql = `SELECT id::text AS id, COALESCE(po_number, contract_ext_no) AS po, document_type, file_path, created_at
           FROM commercial_document_files WHERE created_at >= $1::date ORDER BY created_at`;
    params = [since];
  } else if (days && /^\d{1,4}$/.test(days)) {
    sql = `SELECT id::text AS id, COALESCE(po_number, contract_ext_no) AS po, document_type, file_path, created_at
           FROM commercial_document_files WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day') ORDER BY created_at`;
    params = [Number(days)];
  } else {
    console.error('usage: checkCommercialDocFiles.js --days N | --since YYYY-MM-DD | --po <PO number>');
    return 1;
  }

  const rows = (await pool.query(sql, params)).rows as Array<{ id: string; po: string; document_type: string; file_path: string; created_at: Date }>;
  const missing = rows.filter((r) => !fs.existsSync(resolveUploadAbsolutePath(String(r.file_path))));
  console.log(`checked ${rows.length} document(s): ${missing.length} missing`);
  for (const r of missing.slice(0, 200)) {
    console.log(`  MISSING ${new Date(r.created_at).toISOString().slice(0, 16)}  PO ${r.po}  ${r.document_type}  ${r.file_path}`);
  }
  if (missing.length > 200) console.log(`  ...and ${missing.length - 200} more`);
  return missing.length > 0 || (uploadsMarkerRequired() && uploadsRootProblem() !== null) ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('ERROR', err instanceof Error ? err.message : err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
