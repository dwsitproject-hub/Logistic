/**
 * READ-ONLY. COD / Commercial Documents: were invoice files ever replaced, and which ones can be brought back?
 *
 * The upload code keeps every version of an invoice type (Invoice + FP DP / Payoff / Full); only the Contract type replaces its previous file.
 * This checks the data instead of the code. For the invoice types (and their legacy values) it lists, per PO:
 *
 *   A. DELETED   - a version a user deleted in the app (history has a DELETE row). The file is still on disk, so it can be restored.
 *   B. VANISHED  - history says a file was added, but no row is left in commercial_document_files and no DELETE row explains it.
 *                  Something removed the row without the app's delete (a script, a database edit, or the code of an older release).
 *   C. FILE GONE - a row (or history entry) whose file is no longer on disk (then it cannot be restored from the app's storage).
 *
 * Needs no deploy: it uses the code already inside the running backend image.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-commdocs-invoice-versions.cjs \
 *     | docker exec -i klip-backend node - [--since=2026-01-01] [--po=<PO number>]
 *
 * Nothing is written.
 */
const fs = require('fs');
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const INVOICE_TYPES = ['invoice_fp_dp', 'invoice_fp_payoff', 'invoice_fp_full', 'dp', 'invoice_dp', 'ep_pelunasan', 'invoice_pelunasan'];

(async () => {
  const { query } = dist('database/connection');
  const { resolveUploadAbsolutePath } = dist('utils/fileUpload');
  const since = arg('since', '2020-01-01');
  const po = arg('po', null);
  const onDisk = (p) => {
    try {
      return Boolean(p) && fs.existsSync(resolveUploadAbsolutePath(p));
    } catch {
      return false;
    }
  };
  const poSql = po ? 'AND NULLIF(TRIM(h.po_number), \'\') = $3' : '';
  const params = po ? [INVOICE_TYPES, since, po] : [INVOICE_TYPES, since];

  console.log(`\n== what the history holds for the invoice types since ${since}${po ? ` (PO ${po})` : ''}`);
  const counts = await query(
    `SELECT h.action_type, COUNT(*)::int AS n FROM commercial_document_history h
     WHERE h.document_type = ANY($1::text[]) AND h.created_at >= $2::date ${poSql}
     GROUP BY 1 ORDER BY 1`,
    params,
  );
  counts.rows.forEach((r) => console.log(`  ${r.action_type.padEnd(8)} ${r.n}`));

  // History rows for an invoice file, with whether a live row still points at that path.
  const rows = (
    await query(
      `SELECT h.action_type, h.po_number, h.document_type, h.file_path, h.file_name, h.user_name, h.created_at,
              EXISTS (SELECT 1 FROM commercial_document_files f WHERE f.file_path = h.file_path) AS live,
              EXISTS (SELECT 1 FROM commercial_document_history d WHERE d.action_type = 'DELETE' AND d.file_path = h.file_path) AS deleted_in_app
       FROM commercial_document_history h
       WHERE h.document_type = ANY($1::text[]) AND h.created_at >= $2::date ${poSql}
       ORDER BY h.created_at`,
      params,
    )
  ).rows;

  const added = rows.filter((r) => r.action_type === 'ADD' || r.action_type === 'EDIT');
  const deleted = rows.filter((r) => r.action_type === 'DELETE');
  const vanished = added.filter((r) => !r.live && !r.deleted_in_app);

  const show = (title, list, withDisk) => {
    console.log(`\n== ${title}: ${list.length}`);
    list.slice(0, 200).forEach((r) =>
      console.log(
        `  PO ${String(r.po_number || '-').padEnd(12)} ${String(r.document_type).padEnd(18)} ${String(r.file_name).padEnd(44)} ${new Date(r.created_at).toISOString().slice(0, 16)} ${r.user_name || ''}` +
          (withDisk ? `  ${onDisk(r.file_path) ? 'FILE ON DISK' : 'FILE GONE'}` : ''),
      ),
    );
    if (list.length > 200) console.log(`  ... ${list.length - 200} more`);
  };

  show('A. DELETED in the app (restorable while the file is on disk)', deleted, true);
  show('B. VANISHED: added, no live row, no DELETE entry', vanished, true);

  const goneLive = (
    await query(
      `SELECT po_number, document_type, file_name, file_path FROM commercial_document_files
       WHERE document_type = ANY($1::text[]) ${po ? "AND NULLIF(TRIM(po_number), '') = $2" : ''}`,
      po ? [INVOICE_TYPES, po] : [INVOICE_TYPES],
    )
  ).rows.filter((r) => !onDisk(r.file_path));
  console.log(`\n== C. rows whose file is NOT on disk: ${goneLive.length}`);
  goneLive.slice(0, 50).forEach((r) => console.log(`  PO ${String(r.po_number || '-').padEnd(12)} ${r.document_type.padEnd(18)} ${r.file_name}`));

  const restorable = [...deleted, ...vanished].filter((r) => onDisk(r.file_path));
  console.log(`\n== summary: ${deleted.length} deleted in the app, ${vanished.length} vanished, ${restorable.length} of them with the file still on disk (restorable)`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
