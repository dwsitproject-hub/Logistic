/*
 * READ-ONLY: which export lines of a PO did each SAP import carry (Delete PO / STO status, STO, row status)? For a shipment that an import cancelled
 * while the PO is open now.
 *
 *   cd /opt/klip && cat docs/scripts/diag-sap-po-lines-in-imports.cjs | docker exec -i klip-backend node - --pos=1001031718,1001031313 --from=2026-10-12 --to=2026-10-15
 *
 * Reads sap_raw_data (one row per export line) of every import created in the window, so the lines of the import that cancelled the shipment can be
 * compared with the ones before and after it.
 */
const path = require('path');
const dist = (p) => require(path.join('/app/dist', p));
const pool = dist('database/connection').default;
const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : '';
};
const pos = arg('pos').split(',').map((s) => s.trim()).filter(Boolean);
const from = arg('from') || '2026-10-12';
const to = arg('to') || '2026-10-15';
const day = (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) : '-');

(async () => {
  const imports = await pool.query(
    `SELECT id::text AS id, status, created_at FROM sap_data_imports WHERE created_at >= $1::date AND created_at < $2::date ORDER BY created_at`,
    [from, to],
  );
  for (const imp of imports.rows) {
    console.log('\nimport ' + imp.id + '  ' + imp.status + '  ' + day(imp.created_at));
    for (const po of pos) {
      const rows = await pool.query(
        `SELECT r.row_number, r.status, r.error_message,
                (SELECT jsonb_object_agg(k, v) FROM jsonb_each_text(r.data) AS t(k, v)
                  WHERE k ~* '^(delete (po|sto) status|sto( no\\.?| number)?|po( no\\.?| number)?|contract no\\.?|gr (po|sto) status)$') AS fields
           FROM sap_raw_data r
          WHERE r.import_id = $1::uuid AND r.data::text LIKE '%' || $2 || '%'
          ORDER BY r.row_number`,
        [imp.id, po],
      );
      console.log('  PO ' + po + ': ' + rows.rows.length + ' line(s)');
      for (const r of rows.rows) console.log('     row ' + r.row_number + '  ' + r.status + (r.error_message ? '  ERR ' + r.error_message : '') + '  ' + JSON.stringify(r.fields));
    }
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed:', e && e.message ? e.message : e);
    process.exit(1);
  });
