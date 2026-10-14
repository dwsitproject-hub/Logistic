/**
 * Step 1 of 2 - export, from SIT, the Commercial Documents that Admin Support users uploaded there by mistake (they belonged on
 * production). READ ONLY on the database: nothing in SIT is changed or deleted, the SIT copies stay where they are.
 * Step 2 is docs/scripts/commercial-docs-import-prod.cjs on the production backend.
 *
 * Run on the SIT BACKEND host (iZk1a4m0oobaw170notm7pZ):
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/commercial-docs-export-sit.cjs \
 *     | docker exec -i klip-backend node -
 *   docker cp klip-backend:/tmp/commercial-docs-export ./commercial-docs-export
 *   tar czf commercial-docs-export.tgz commercial-docs-export
 *
 * What is exported
 *  - Every row of commercial_document_files whose uploader's role is ADMIN_SUPPORT on SIT, all dates. A file deleted on SIT
 *    has no row any more and is therefore not exported.
 *  - Each file is copied as files/<id>.<ext> with its SHA-256, so the import can prove it arrived intact.
 *  - The settlement_invoice_summaries (OCR of the settlement invoice) created or last edited by an Admin Support user.
 *  - Uploaders are identified by EMAIL: SIT and production have different user ids.
 *
 * A row whose file is missing on the SIT disk is listed in the manifest under `missing_files` and not exported.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const OUT_DIR = process.env.EXPORT_DIR || '/tmp/commercial-docs-export';
const ROLE = process.env.EXPORT_ROLE || 'ADMIN_SUPPORT'; // override only for a local test

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const pool = dist('database/connection').default;
  const { resolveUploadAbsolutePath } = dist('utils/fileUpload');

  if (fs.existsSync(OUT_DIR)) {
    console.error(`${OUT_DIR} already exists - remove it first (docker exec klip-backend rm -rf ${OUT_DIR}).`);
    await pool.end();
    process.exit(1);
  }

  const files = await pool.query(
    `SELECT f.id, f.contract_ext_no, NULLIF(TRIM(f.po_number), '') AS po_number, f.document_type, f.file_path, f.file_name,
            f.file_size, f.mime_type, f.checked, f.created_at, f.updated_at,
            LOWER(TRIM(u.email)) AS uploader_email, u.username AS uploader_username, u.full_name AS uploader_full_name
       FROM commercial_document_files f
       JOIN users u ON u.id = f.uploaded_by
      WHERE u.role = $1
      ORDER BY f.created_at ASC, f.id ASC`,
    [ROLE],
  );

  const summaries = await pool.query(
    `SELECT s.id, s.contract_ext_no, NULLIF(TRIM(s.po_number), '') AS po_number, s.commercial_document_file_id,
            s.gross_amount, s.discount_amount, s.down_payment, s.subtotal, s.tax_base_amount, s.vat_12_percent,
            s.total_payable, s.created_at, s.updated_at,
            LOWER(TRIM(cu.email)) AS created_by_email, LOWER(TRIM(uu.email)) AS updated_by_email
       FROM settlement_invoice_summaries s
       LEFT JOIN users cu ON cu.id = s.created_by
       LEFT JOIN users uu ON uu.id = s.updated_by
      WHERE cu.role = $1 OR uu.role = $1
      ORDER BY s.created_at ASC`,
    [ROLE],
  );

  fs.mkdirSync(path.join(OUT_DIR, 'files'), { recursive: true });
  const exported = [];
  const missing = [];
  for (const r of files.rows) {
    const abs = resolveUploadAbsolutePath(r.file_path);
    if (!fs.existsSync(abs)) {
      missing.push({ id: r.id, po_number: r.po_number, document_type: r.document_type, file_path: r.file_path });
      continue;
    }
    const ext = (path.extname(r.file_name || r.file_path) || '.pdf').toLowerCase();
    const rel = `files/${r.id}${ext}`;
    fs.copyFileSync(abs, path.join(OUT_DIR, rel));
    exported.push({ ...r, export_file: rel, sha256: sha256(abs), bytes: fs.statSync(abs).size });
  }

  const manifest = {
    exported_at: new Date().toISOString(),
    source: 'SIT',
    role: ROLE,
    files: exported,
    missing_files: missing,
    settlement_summaries: summaries.rows,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const byUser = {};
  for (const r of exported) byUser[r.uploader_email] = (byUser[r.uploader_email] || 0) + 1;
  const byType = {};
  for (const r of exported) byType[r.document_type] = (byType[r.document_type] || 0) + 1;

  console.log(`Exported ${exported.length} file(s) to ${OUT_DIR} (${new Set(exported.map((r) => r.po_number)).size} PO).`);
  console.log('Per uploader:', byUser);
  console.log('Per document type:', byType);
  console.log(`Settlement summaries: ${summaries.rows.length}`);
  if (missing.length) {
    console.log(`WARNING: ${missing.length} row(s) have no file on the SIT disk and were NOT exported:`);
    for (const m of missing) console.log(`  ${m.po_number}  ${m.document_type}  ${m.file_path}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
