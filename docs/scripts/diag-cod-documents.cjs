/*
 * READ-ONLY check of the COD <-> KLIP document integration. Writes nothing and sends nothing (the Jetty mail is only BUILT, never sent).
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cod-documents.cjs | docker exec -i klip-backend node -
 *   (production: the same with origin/main)
 *
 * It proves the new SQL RUNS on this database (the JPS eligibility query now has a cod_contract CTE, the COD file query is new) and measures what the feature changes:
 *   1. what COD holds (Contract / Addendum / DO files, POs with several versions) and what the KLIP-facing file query returns for a few of them;
 *   2. the JPS eligibility query end to end: how many STOs get their Contract link from KLIP, from COD, or have none;
 *   3. the Jetty mail attachments for a few eligible STOs (file names and what would be skipped);
 *   4. Trucking: how many documents the View DO dialog would list, and how many of them are not DO (the contract documents of the Contracts page also show there today).
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const line = (s = '') => console.log(s);
const head = (s) => {
  line();
  line(`== ${s}`);
};

(async () => {
  const pool = dist('database/connection').default;
  try {
    const { COD_FILES_SQL, groupCodFiles } = dist('utils/codFiles');
    const { findEligibleStos } = dist('jps/eligibility');
    const { jpsEnabledPortNames } = dist('jps/config');
    const { loadNotifyAttachments } = dist('jps/notifyEmail');
    const q = (sql, params) => pool.query(sql, params);

    head('1. Commercial Documents files');
    const byType = (
      await q(
        `SELECT document_type, COUNT(*)::int AS files, COUNT(DISTINCT po_number)::int AS pos FROM commercial_document_files
          WHERE document_type IN ('contract','addendum_contract','delivery_order') GROUP BY 1 ORDER BY 1`,
      )
    ).rows;
    for (const r of byType) line(`  ${r.document_type.padEnd(18)} ${String(r.files).padStart(6)} files on ${String(r.pos).padStart(6)} POs`);
    const multi = (
      await q(
        `SELECT po_number, document_type, COUNT(*)::int AS versions FROM commercial_document_files
          WHERE document_type IN ('contract','delivery_order') AND NULLIF(TRIM(po_number), '') IS NOT NULL
          GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY 3 DESC, 1 LIMIT 5`,
      )
    ).rows;
    line(`  PO + type with more than one version: ${multi.length === 0 ? 'none' : ''}`);
    for (const m of multi) line(`    ${m.po_number} ${m.document_type} x${m.versions}`);
    if (multi.length > 0) {
      const rows = (await q(COD_FILES_SQL, [[...new Set(multi.map((m) => m.po_number))], ['contract', 'delivery_order']])).rows;
      for (const g of groupCodFiles(rows)) {
        line(`  KLIP query -> PO ${g.poNumber} ${g.type}: ${g.versions.map((v) => `v${v.version}${v.isLatest ? '*' : ''} ${v.uploadedBy || '-'}`).join(' | ')}`);
      }
    }

    head('2. JPS eligibility: where the Contract link comes from');
    const ports = jpsEnabledPortNames();
    line(`  ports switched on for JPS: ${ports.length === 0 ? '(none: nothing is eligible here, so this part says nothing)' : ports.join(', ')}`);
    const stos = await findEligibleStos(ports, 500, {});
    line(`  eligible STOs found: ${stos.length}`);
    const ids = stos.map((s) => s.contract_document_url ?? null);
    const idOf = (u) => (u ? String(u).split('/').slice(-2)[0] : null);
    const idList = ids.map(idOf).filter(Boolean);
    const inDocs = new Set((await q(`SELECT id::text AS id FROM documents WHERE id::text = ANY($1::text[])`, [idList])).rows.map((r) => r.id));
    const inCod = new Set((await q(`SELECT id::text AS id FROM commercial_document_files WHERE id::text = ANY($1::text[])`, [idList])).rows.map((r) => r.id));
    let klip = 0;
    let cod = 0;
    let none = 0;
    for (const u of ids) {
      const id = idOf(u);
      if (!id) none += 1;
      else if (inCod.has(id)) cod += 1;
      else if (inDocs.has(id)) klip += 1;
      else none += 1;
    }
    line(`  Contract link from KLIP: ${klip}   from COD (new): ${cod}   none: ${none}`);
    if (stos.length > 0 && ids.every((u) => u == null)) line('  (contract_document_url is empty everywhere: APP_PUBLIC_ORIGIN / FRONTEND_URL is not set on this host, so the links cannot be built)');

    head('3. Jetty mail attachments (built, not sent)');
    for (const sto of stos.slice(0, 6)) {
      const out = await loadNotifyAttachments(sto);
      line(`  STO ${sto.sto_key}: ${out.attachments.map((a) => a.filename).join(', ') || '(no attachment)'}${out.skipped.length ? `   NOT ATTACHED: ${out.skipped.map((s) => `${s.kind} - ${s.reason}`).join('; ')}` : ''}`);
    }
    if (stos.length === 0) line('  (no eligible STO on this database)');

    head('4. Trucking: what the View DO dialog lists');
    const t = (
      await q(
        `SELECT
           COUNT(*) FILTER (WHERE d.trucking_operation_id IS NOT NULL)::int AS on_operation,
           COUNT(*) FILTER (WHERE d.trucking_operation_id IS NULL AND d.contract_id IS NOT NULL AND d.file_path LIKE 'documents/trucking/%')::int AS contract_from_trucking,
           COUNT(*) FILTER (WHERE d.trucking_operation_id IS NULL AND d.contract_id IS NOT NULL AND COALESCE(d.file_path, '') NOT LIKE 'documents/trucking/%')::int AS contract_other_pages,
           COUNT(*) FILTER (WHERE UPPER(d.document_type) = 'DO')::int AS typed_do
         FROM documents d WHERE d.deleted_at IS NULL`,
      )
    ).rows[0];
    line(`  documents on a trucking operation (uploaded from Trucking)       : ${t.on_operation}`);
    line(`  documents on a contract, filed from Trucking (documents/trucking/): ${t.contract_from_trucking}`);
    line(`  documents on a contract from OTHER pages (Contracts page...)      : ${t.contract_other_pages}   <- these also appear in the Trucking dialog today and are not DO`);
    line(`  already typed DO                                                  : ${t.typed_do}`);
    const byTypeTrucking = (
      await q(`SELECT UPPER(document_type) AS t, COUNT(*)::int AS n FROM documents WHERE deleted_at IS NULL AND trucking_operation_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`)
    ).rows;
    line(`  types on trucking operations: ${byTypeTrucking.map((r) => `${r.t} ${r.n}`).join(', ') || '-'}`);
    const overlap = (
      await q(
        `SELECT COUNT(DISTINCT c.po_number)::int AS n
           FROM commercial_document_files f
           JOIN contracts c ON NULLIF(TRIM(c.po_number), '') = f.po_number
           JOIN trucking_operations o ON o.contract_id = c.id
          WHERE f.document_type = 'delivery_order'`,
      )
    ).rows[0];
    line(`  POs with a COD DO and a trucking operation (they gain a file in View DO): ${overlap.n}`);
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
