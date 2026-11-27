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
    // --ports="PORT BONTANG,PORT X" tries other Master Ports WITHOUT touching the Integrations setting (read-only either way). Without it, the ports switched on for JPS are used.
    const portsArg = process.argv.find((a) => a.startsWith('--ports='));
    const enabled = jpsEnabledPortNames();
    const ports = portsArg ? portsArg.slice('--ports='.length).split(',').map((s) => s.trim()).filter(Boolean) : enabled;
    line(`  ports switched on for JPS: ${enabled.length === 0 ? '(none)' : enabled.join(', ')}${portsArg ? `   -> trying instead: ${ports.join(', ')}` : ''}`);
    if (ports.length === 0) {
      const cand = (
        await q(
          `SELECT mp.port, COUNT(*)::int AS n FROM shipments s JOIN master_loading_ports mp ON mp.id = s.discharge_master_port_id
            WHERE COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED') GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
        )
      ).rows;
      line('  no port to ask for, so nothing is eligible. Open shipments by discharge Master Port (pass one with --ports="<name>"):');
      for (const c of cand) line(`    ${String(c.n).padStart(4)}  ${c.port}`);
    }
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
    const fs = require('fs');
    const { resolveUploadAbsolutePath } = dist('utils/fileUpload');
    for (const sto of stos.slice(0, 6)) {
      const out = await loadNotifyAttachments(sto);
      line(`  STO ${sto.sto_key}: ${out.attachments.map((a) => a.filename).join(', ') || '(no attachment)'}${out.skipped.length ? `   NOT ATTACHED: ${out.skipped.map((s) => `${s.kind} - ${s.reason}`).join('; ')}` : ''}`);
      // Where the JPS Contract link of this STO points, and whether the mail can see that same document: the mail reads the shipments listed in shipment_ids, the JPS link reads every shipment of the STO.
      const cid = idOf(sto.contract_document_url);
      line(`      shipments the mail reads: ${sto.shipment_ids.length}   JPS Contract link: ${cid ? cid : '(none)'}`);
      if (cid) {
        const d = (await q(`SELECT id::text AS id, document_type, shipment_id::text AS shipment_id, file_name, file_path, deleted_at FROM documents WHERE id::text = $1`, [cid])).rows[0];
        if (d) {
          const inMail = sto.shipment_ids.includes(d.shipment_id);
          let exists = false;
          try {
            exists = fs.existsSync(resolveUploadAbsolutePath(d.file_path));
          } catch {
            exists = false;
          }
          line(`      -> KLIP document ${d.document_type} "${d.file_name}" on shipment ${d.shipment_id}: ${inMail ? 'IN' : 'NOT IN'} the shipments the mail reads; deleted: ${d.deleted_at ? 'yes' : 'no'}; file on disk: ${exists ? 'yes' : 'NO'}`);
          const sib = (await q(`SELECT s.id::text AS id, s.shipment_id, s.status, s.contract_id::text AS contract_id FROM shipments s WHERE s.id::text = $1`, [d.shipment_id])).rows[0];
          if (sib) line(`         that shipment: ${sib.shipment_id} status ${sib.status} contract ${sib.contract_id}`);
        }
      }
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
    const examples = (
      await q(
        `SELECT DISTINCT c.po_number, o.operation_id, f.file_name
           FROM commercial_document_files f
           JOIN contracts c ON NULLIF(TRIM(c.po_number), '') = f.po_number
           JOIN trucking_operations o ON o.contract_id = c.id
          WHERE f.document_type = 'delivery_order'
          ORDER BY c.po_number, o.operation_id LIMIT 8`,
      )
    ).rows;
    for (const e of examples) line(`    to try: PO ${e.po_number}  operation ${e.operation_id}  (COD file ${e.file_name})`);
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
