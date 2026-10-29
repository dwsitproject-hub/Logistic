/**
 * Step 2 of 2 - put the Commercial Documents exported from SIT (commercial-docs-export-sit.cjs) onto PRODUCTION.
 * Dry run unless --apply. Nothing on production is overwritten or deleted.
 *
 * Run on the production BACKEND host (ECS-DB), with the export unpacked next to you:
 *
 *   tar xzf commercial-docs-export.tgz
 *   docker cp ./commercial-docs-export klip-backend:/tmp/commercial-docs-export
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/commercial-docs-import-prod.cjs \
 *     > /tmp/commercial-docs-import-prod.cjs
 *   docker exec -i klip-backend node - < /tmp/commercial-docs-import-prod.cjs                 # dry run: the plan only
 *   docker exec -i klip-backend node - --apply < /tmp/commercial-docs-import-prod.cjs         # does it
 *   docker exec -i klip-backend node - --rollback=/tmp/commercial-docs-import-<stamp>.json < /tmp/commercial-docs-import-prod.cjs
 *
 * Rules (agreed with Ryan, 2026-10-14)
 *  - All Admin Support uploads, every date.
 *  - A PO + document type that production already has: the SIT file is ADDED as the next version ("(2)", "(3)", ...), the
 *    production file stays. This includes Contract: the import never deletes a production file, unlike a fresh upload.
 *  - Exception: a production file of the same PO + type with byte-identical content (same SHA-256) means the document is
 *    already there (the user re-uploaded it, or this import already ran) - skipped, so a re-run is harmless.
 *  - The settlement invoice summary (OCR) comes along when production has none for that PO; one already on production wins.
 *  - Held back and reported, never guessed: a PO that production does not have, an uploader whose email has no production
 *    account, a file whose checksum does not match the manifest.
 *  - The original upload time is kept. The file lands in the folder production would have used at that time
 *    (commercial-docs/<YYYY>/<MM>/<PO> on the NAS layout). Each migrated file gets one history row (ADD, or EDIT when it is a
 *    next version) whose user name ends in " [migrasi dari SIT]", so the page shows where it came from.
 *  - --apply copies the files, then writes all rows in ONE transaction. If the transaction fails, the copied files are removed.
 *    A log of every id and path written is saved to /tmp/commercial-docs-import-<stamp>.json; --rollback=<log> undoes it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const IN_DIR = process.env.IMPORT_DIR || '/tmp/commercial-docs-export';
const LOG_DIR = process.env.LOG_DIR || '/tmp';
const MARKER = ' [migrasi dari SIT]';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** "EOP_Ctr_PO123(2).pdf" -> { stem: "EOP_Ctr_PO123", ext: "pdf" } */
function splitStoredName(name) {
  const m = /^(.*?)(\(\d+\))?\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  if (!m) return { stem: String(name || 'document').trim() || 'document', ext: 'pdf' };
  return { stem: m[1], ext: m[3].toLowerCase() };
}

async function rollback(pool, logFile) {
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(`DELETE FROM commercial_document_history WHERE id = ANY($1::uuid[])`, [log.history_ids]);
    const s = await client.query(`DELETE FROM settlement_invoice_summaries WHERE id = ANY($1::uuid[])`, [log.summary_ids]);
    const f = await client.query(`DELETE FROM commercial_document_files WHERE id = ANY($1::uuid[])`, [log.file_ids]);
    await client.query('COMMIT');
    let removed = 0;
    for (const abs of log.written_paths) {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
        removed += 1;
      }
    }
    console.log(`Rolled back: ${f.rowCount} file row(s), ${h.rowCount} history row(s), ${s.rowCount} summary(ies), ${removed} file(s) on disk.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rollbackArg = process.argv.find((a) => a.startsWith('--rollback='));
  const pool = dist('database/connection').default;
  const { getUploadRootDir, toRelativeUploadPath } = dist('utils/fileUpload');
  const {
    commercialDocumentUploadRelativeDir,
    canonicalCommercialDocumentType,
    documentTypesForCategory,
    useCommercialDocsNasLayout,
  } = dist('utils/commercialDocumentsConstants');
  const { resolveUploadAbsolutePath } = dist('utils/fileUpload');

  if (rollbackArg) {
    await rollback(pool, rollbackArg.slice('--rollback='.length));
    await pool.end();
    return;
  }

  const manifestPath = path.join(IN_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${manifestPath} not found - docker cp the export into the container first.`);
    await pool.end();
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Manifest: ${manifest.files.length} file(s), ${manifest.settlement_summaries.length} summary(ies), exported ${manifest.exported_at}.`);
  console.log(`Upload root: ${getUploadRootDir()}  (NAS layout: ${useCommercialDocsNasLayout() ? 'yes' : 'NO'})`);
  if (!useCommercialDocsNasLayout()) {
    console.log('WARNING: this backend does not use the production NAS layout - is this really production?');
  }

  const pos = [...new Set([...manifest.files, ...manifest.settlement_summaries].map((r) => r.po_number).filter(Boolean))];
  const emails = [
    ...new Set(
      [
        ...manifest.files.map((r) => r.uploader_email),
        ...manifest.settlement_summaries.flatMap((s) => [s.created_by_email, s.updated_by_email]),
      ].filter(Boolean),
    ),
  ];

  const contractRows = await pool.query(
    `SELECT DISTINCT ON (TRIM(po_number)) TRIM(po_number) AS po, id
       FROM contracts WHERE TRIM(po_number) = ANY($1::text[])
      ORDER BY TRIM(po_number), updated_at DESC NULLS LAST`,
    [pos],
  );
  const contractByPo = new Map(contractRows.rows.map((r) => [r.po, r.id]));
  const userRows = await pool.query(
    `SELECT id, LOWER(TRIM(email)) AS email, username FROM users WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
    [emails],
  );
  const userByEmail = new Map(userRows.rows.map((r) => [r.email, r]));
  const prodFiles = await pool.query(
    `SELECT id, NULLIF(TRIM(po_number), '') AS po_number, document_type, file_path, file_name
       FROM commercial_document_files WHERE NULLIF(TRIM(po_number), '') = ANY($1::text[])`,
    [pos],
  );
  const prodSummaries = await pool.query(
    `SELECT NULLIF(TRIM(po_number), '') AS po FROM settlement_invoice_summaries WHERE NULLIF(TRIM(po_number), '') = ANY($1::text[])`,
    [pos],
  );
  const poWithSummary = new Set(prodSummaries.rows.map((r) => r.po));

  // Category key: po + canonical type, because a legacy type shares the version numbering of its category.
  const catKey = (po, type) => `${po}|${canonicalCommercialDocumentType(type) || type}`;
  const countByCat = new Map();
  const shaByCat = new Map();
  for (const r of prodFiles.rows) {
    const k = catKey(r.po_number, r.document_type);
    countByCat.set(k, (countByCat.get(k) || 0) + 1);
    const abs = resolveUploadAbsolutePath(r.file_path);
    if (fs.existsSync(abs)) {
      if (!shaByCat.has(k)) shaByCat.set(k, new Set());
      shaByCat.get(k).add(sha256(abs));
    }
  }

  const plan = [];
  const held = [];
  const skipped = [];
  const plannedPaths = new Set();
  for (const r of manifest.files) {
    const src = path.join(IN_DIR, r.export_file);
    const why = (reason) => held.push({ reason, po: r.po_number, type: r.document_type, name: r.file_name, by: r.uploader_email });
    if (!r.po_number) { why('no PO on the SIT row'); continue; }
    if (!contractByPo.has(r.po_number)) { why('PO not on production'); continue; }
    const user = userByEmail.get(r.uploader_email);
    if (!user) { why('uploader has no production account'); continue; }
    if (!fs.existsSync(src) || sha256(src) !== r.sha256) { why('file missing or checksum mismatch in the export'); continue; }

    const k = catKey(r.po_number, r.document_type);
    if (shaByCat.get(k)?.has(r.sha256)) {
      skipped.push({ reason: 'identical file already on production', po: r.po_number, type: r.document_type, name: r.file_name });
      continue;
    }

    const existing = countByCat.get(k) || 0;
    const createdAt = new Date(r.created_at);
    const dir = path.join(getUploadRootDir(), commercialDocumentUploadRelativeDir(r.po_number, createdAt));
    const { stem, ext } = splitStoredName(r.file_name);
    let storedName = '';
    let abs = '';
    for (let bump = 0; bump < 50; bump += 1) {
      const n = existing + bump;
      storedName = n <= 0 ? `${stem}.${ext}` : `${stem}(${n + 1}).${ext}`;
      abs = path.join(dir, storedName);
      if (!fs.existsSync(abs) && !plannedPaths.has(abs)) break;
      abs = '';
    }
    if (!abs) { why('no free file name after 50 tries'); continue; }
    plannedPaths.add(abs);
    countByCat.set(k, existing + 1);
    if (!shaByCat.has(k)) shaByCat.set(k, new Set());
    shaByCat.get(k).add(r.sha256);

    plan.push({
      sitId: r.id,
      src,
      abs,
      dir,
      storedName,
      action: existing > 0 ? 'EDIT' : 'ADD',
      row: r,
      userId: user.id,
      userName: `${user.username || user.email}${MARKER}`,
    });
  }

  const sitFileToPlan = new Map(plan.map((p) => [p.sitId, p]));
  const summaryPlan = [];
  for (const s of manifest.settlement_summaries) {
    if (!s.po_number || !contractByPo.has(s.po_number)) {
      held.push({ reason: 'PO not on production', po: s.po_number, type: 'settlement summary' });
      continue;
    }
    if (poWithSummary.has(s.po_number)) {
      skipped.push({ reason: 'production already has a settlement summary', po: s.po_number, type: 'settlement summary' });
      continue;
    }
    summaryPlan.push({
      s,
      contractId: contractByPo.get(s.po_number),
      createdBy: userByEmail.get(s.created_by_email)?.id ?? null,
      updatedBy: userByEmail.get(s.updated_by_email)?.id ?? null,
      sitFileId: s.commercial_document_file_id,
    });
    poWithSummary.add(s.po_number);
  }

  console.log('');
  console.log(`To add: ${plan.length} file(s) (${plan.filter((p) => p.action === 'EDIT').length} as a next version), ${summaryPlan.length} summary(ies).`);
  for (const p of plan) {
    console.log(`  ${p.action.padEnd(4)} ${p.row.po_number}  ${p.row.document_type.padEnd(18)} ${toRelativeUploadPath(p.abs)}  (${p.row.uploader_email})`);
  }
  for (const sp of summaryPlan) console.log(`  SUMMARY ${sp.s.po_number}`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.length}`);
    for (const x of skipped) console.log(`  ${x.po}  ${x.type}  ${x.name || ''}  - ${x.reason}`);
  }
  if (held.length) {
    console.log(`HELD BACK (needs a decision): ${held.length}`);
    for (const x of held) console.log(`  ${x.po}  ${x.type}  ${x.name || ''}  ${x.by || ''}  - ${x.reason}`);
  }
  if (manifest.missing_files?.length) {
    console.log(`Not in the export (file missing on the SIT disk): ${manifest.missing_files.length}`);
  }

  if (!apply) {
    console.log('\nDry run - nothing written. Re-run with --apply.');
    await pool.end();
    return;
  }
  if (plan.length === 0 && summaryPlan.length === 0) {
    console.log('\nNothing to do.');
    await pool.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `commercial-docs-import-${stamp}.json`);
  const log = { applied_at: new Date().toISOString(), file_ids: [], history_ids: [], summary_ids: [], written_paths: [] };
  try {
    for (const p of plan) {
      fs.mkdirSync(p.dir, { recursive: true });
      fs.copyFileSync(p.src, p.abs, fs.constants.COPYFILE_EXCL);
      log.written_paths.push(p.abs);
      if (sha256(p.abs) !== p.row.sha256) throw new Error(`Checksum mismatch after copy: ${p.abs}`);
    }
  } catch (err) {
    for (const abs of log.written_paths) try { fs.unlinkSync(abs); } catch { /* ignore */ }
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const newFileIdBySit = new Map();
    for (const p of plan) {
      const relativePath = toRelativeUploadPath(p.abs);
      const r = p.row;
      const ins = await client.query(
        `INSERT INTO commercial_document_files
           (contract_ext_no, po_number, document_type, file_path, file_name, file_size, mime_type, checked, uploaded_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [r.contract_ext_no, r.po_number, r.document_type, relativePath, p.storedName, r.bytes, r.mime_type, r.checked !== false, p.userId, r.created_at],
      );
      const fileId = ins.rows[0].id;
      newFileIdBySit.set(p.sitId, fileId);
      log.file_ids.push(fileId);
      const hist = await client.query(
        `INSERT INTO commercial_document_history
           (contract_ext_no, po_number, document_type, action_type, file_path, file_name, user_id, user_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [r.contract_ext_no, r.po_number, r.document_type, p.action, relativePath, p.storedName, p.userId, p.userName, r.created_at],
      );
      log.history_ids.push(hist.rows[0].id);
    }
    for (const sp of summaryPlan) {
      const s = sp.s;
      const ins = await client.query(
        `INSERT INTO settlement_invoice_summaries
           (contract_ext_no, po_number, commercial_document_file_id, contract_id, gross_amount, discount_amount, down_payment,
            subtotal, tax_base_amount, vat_12_percent, total_payable, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [
          s.contract_ext_no, s.po_number, (sp.sitFileId && newFileIdBySit.get(sp.sitFileId)) || null, sp.contractId,
          s.gross_amount, s.discount_amount, s.down_payment, s.subtotal, s.tax_base_amount, s.vat_12_percent, s.total_payable,
          sp.createdBy, sp.updatedBy, s.created_at, s.updated_at,
        ],
      );
      log.summary_ids.push(ins.rows[0].id);
    }
    // Written before COMMIT: rows that commit without a rollback log would have to be found by hand.
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    for (const abs of log.written_paths) try { fs.unlinkSync(abs); } catch { /* ignore */ }
    try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    client.release();
    await pool.end();
    console.error('Transaction rolled back, copied files removed.');
    throw err;
  }
  client.release();

  console.log(`\nApplied: ${log.file_ids.length} file(s), ${log.summary_ids.length} summary(ies). Log: ${logFile}`);
  console.log(`Keep it: docker cp klip-backend:${logFile} .   (needed for --rollback)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
