/**
 * READ-ONLY: why is a PO on the Commercial Documents (COD) list although SAP cancelled it? Changes nothing.
 *
 *   docker cp docs/scripts/diag-commercial-po-status.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-commercial-po-status.cjs 1011003239
 *
 * It prints what KLIP holds for the PO, i.e. what the COD list is built from:
 *   - the contracts row(s): status as KLIP stores it (a Delete PO/STO line makes the import write 'Cancelled'),
 *   - the stored SAP rows (sap_processed_data), newest first: the status the import saw, and the Delete PO / Delete STO flags on each line,
 *   - whether the COD list would show it (the list reads every contracts row; it has no cancelled filter),
 *   - how many documents are uploaded for it.
 */
const path = require('path');

const pool = require(path.join(process.cwd(), 'dist', 'database', 'connection')).default;
const po = process.argv[2];

(async () => {
  if (!po) {
    console.error('usage: node /app/diag-commercial-po-status.cjs <PO number>');
    process.exitCode = 1;
    return;
  }
  const contracts = await pool.query(
    `SELECT c.id::text AS id, c.contract_id, c.po_number, c.status, c.contract_date, c.supplier, c.updated_at
     FROM contracts c WHERE NULLIF(TRIM(c.po_number), '') = $1 ORDER BY c.contract_date DESC NULLS LAST`,
    [po],
  );
  console.log(`\n=== contracts rows for PO ${po}: ${contracts.rows.length}`);
  for (const c of contracts.rows) {
    console.log(`- contract ${c.contract_id}  status="${c.status}"  date=${c.contract_date ? new Date(c.contract_date).toISOString().slice(0, 10) : '-'}  updated=${c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 16) : '-'}  supplier=${c.supplier || '-'}`);
  }

  const spd = await pool.query(
    `SELECT s.contract_number, s.po_number, s.sto_number, s.created_at,
            s.data->'contract'->>'status' AS import_status,
            COALESCE(s.data->'raw'->>'Delete PO Status', s.data->'contract'->>'delete_po_status') AS delete_po,
            COALESCE(s.data->'raw'->>'Delete STO Status', s.data->'contract'->>'delete_sto_status') AS delete_sto
     FROM sap_processed_data s
     WHERE NULLIF(TRIM(s.po_number), '') = $1
        OR s.contract_number IN (SELECT contract_id FROM contracts WHERE NULLIF(TRIM(po_number), '') = $1)
     ORDER BY s.created_at DESC NULLS LAST LIMIT 12`,
    [po],
  );
  console.log(`\n=== stored SAP rows (newest first, up to 12): ${spd.rows.length}`);
  for (const r of spd.rows) {
    console.log(`- ${new Date(r.created_at).toISOString().slice(0, 16)}  contract ${r.contract_number || '-'}  STO ${r.sto_number || '-'}  import_status="${r.import_status || ''}"  Delete PO="${r.delete_po || ''}"  Delete STO="${r.delete_sto || ''}"`);
  }

  const docs = await pool.query(
    `SELECT document_type, COUNT(*)::int AS n FROM commercial_document_files WHERE NULLIF(TRIM(po_number), '') = $1 GROUP BY document_type ORDER BY document_type`,
    [po],
  );
  console.log(`\n=== documents uploaded for this PO: ${docs.rows.reduce((a, r) => a + r.n, 0)}`);
  for (const d of docs.rows) console.log(`- ${d.document_type}: ${d.n}`);

  console.log('\n=== verdict');
  console.log('The COD list reads every row of "contracts" and has no cancelled filter, so a cancelled PO stays on it as long as its contracts row exists.');
  const cancelled = contracts.rows.some((c) => String(c.status || '').trim().toUpperCase().startsWith('CANCEL'));
  console.log(cancelled ? 'KLIP stores this PO as Cancelled: a cancelled filter on the COD list would hide it.' : 'KLIP does NOT store this PO as Cancelled (see the status above and the Delete flags): the SAP cancellation has not reached KLIP, or it is only a per-STO delete.');
  await pool.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
