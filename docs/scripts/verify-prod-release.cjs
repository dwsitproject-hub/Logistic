/*
 * READ-ONLY post-deploy check for the release that carries Commercial Documents (migrations 244 / 245), the cancelled-PO fixes and the Layout hydration fix.
 * Changes nothing: every statement is a SELECT.
 *
 *   cd /opt/klip && cat docs/scripts/verify-prod-release.cjs | docker exec -i klip-backend node -
 *
 * Run it on the BACKEND host (ECS-DB) after deploy-prod-backend.sh. Exit code 1 when any check fails.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const connection = load('database/connection');
const { sqlShipmentGroupStatusAgg } = load('utils/shipmentListFilters');
const { sqlShipmentListPrimaryOrderBy } = load('utils/shipmentListPrimaryShipmentSql');

let failed = 0;
const report = (ok, label, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '[ OK ]' : '[FAIL]'} ${label}${detail ? '  ' + detail : ''}`);
};
const q = (sql, params) => connection.query(sql, params).then((r) => r.rows);

const UPLOAD_TYPES = [
  'draft_contract',
  'contract',
  'addendum_contract',
  'berita_acara',
  'bea_cukai',
  'delivery_order',
  'invoice_fp_dp',
  'invoice_fp_payoff',
  'invoice_fp_full',
];

(async () => {
  // 1. migrations recorded
  const mig = await q(`SELECT filename FROM schema_migrations WHERE filename LIKE '244\\_%' OR filename LIKE '245\\_%' ORDER BY filename`);
  report(mig.length === 2, 'migrations 244 and 245 are recorded', mig.map((r) => r.filename).join(', '));

  // 2. Berita Acara accepted by the document_type check
  const chk = await q(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'commercial_document_files_document_type_check'`,
  );
  report(chk.length === 1 && chk[0].def.includes("'berita_acara'"), "document_type check allows 'berita_acara'");

  // 3. the nine upload permissions exist
  const perms = await q(`SELECT permission_key FROM permissions WHERE permission_key LIKE 'data.commercial_documents.upload.%'`);
  const have = new Set(perms.map((r) => r.permission_key.replace('data.commercial_documents.upload.', '')));
  const missing = UPLOAD_TYPES.filter((t) => !have.has(t));
  report(missing.length === 0, 'nine upload permissions exist', missing.length ? 'missing: ' + missing.join(', ') : '');

  // 4. who may upload each type (roles holding create or edit)
  const grants = await q(
    `SELECT REPLACE(p.permission_key, 'data.commercial_documents.upload.', '') AS doc_type,
            ARRAY_AGG(DISTINCT r.role_name ORDER BY r.role_name) AS roles
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id AND p.permission_key LIKE 'data.commercial_documents.upload.%'
       JOIN roles r ON r.id = rp.role_id
      WHERE rp.can_create OR rp.can_edit
      GROUP BY 1 ORDER BY 1`,
  );
  console.log('\nUpload access by document type (roles with create/edit; ADMIN always may):');
  for (const g of grants) console.log(`  ${g.doc_type.padEnd(20)} ${g.roles.join(', ')}`);
  console.log('');
  const rolesOf = (t) => (grants.find((g) => g.doc_type === t) || { roles: [] }).roles.filter((x) => x !== 'ADMIN');
  const doOnly = rolesOf('delivery_order').every((x) => x === 'LOGISTICS');
  const bcOnly = rolesOf('bea_cukai').every((x) => x === 'BC');
  report(doOnly, 'DO is uploadable only by LOGISTICS (and ADMIN)', rolesOf('delivery_order').join(', '));
  report(bcOnly, 'Bea Cukai is uploadable only by BC (and ADMIN)', rolesOf('bea_cukai').join(', '));
  const others = UPLOAD_TYPES.filter((t) => t !== 'delivery_order' && t !== 'bea_cukai');
  const empty = others.filter((t) => rolesOf(t).length === 0);
  report(empty.length === 0, 'every other type is still uploadable by at least one non-ADMIN role', empty.length ? 'nobody: ' + empty.join(', ') : '');

  // 5. new Shipments SQL (group status aggregate + primary-row ordering) runs on this database
  try {
    const rows = await q(
      `SELECT COALESCE(NULLIF(TRIM(s.operation_id), ''), s.shipment_id) AS k,
              ${sqlShipmentGroupStatusAgg('s')} AS status,
              (ARRAY_AGG(s.id ORDER BY ${sqlShipmentListPrimaryOrderBy("COALESCE(NULLIF(TRIM(s.operation_id), ''), s.shipment_id)")}))[1] AS primary_id
         FROM shipments s
        GROUP BY 1
        LIMIT 50`,
    );
    report(rows.length > 0, 'Shipments group status aggregate and primary-row ordering execute', `${rows.length} sample groups`);
  } catch (e) {
    report(false, 'Shipments group status aggregate and primary-row ordering execute', String(e.message || e));
  }

  // 6. groups that mix a cancelled and an active member: the group must not read CANCELLED
  const mixed = await q(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE grp_status IN ('CANCELLED','CANCELED'))::int AS read_cancelled
       FROM (
         SELECT ${sqlShipmentGroupStatusAgg('s')} AS grp_status
           FROM shipments s
          WHERE COALESCE(NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), '')) IS NOT NULL
          GROUP BY COALESCE(NULLIF(TRIM(s.operation_id), ''), NULLIF(TRIM(s.shipment_id), ''))
         HAVING COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(s.status,''))) IN ('CANCELLED','CANCELED')) > 0
            AND COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(s.status,''))) NOT IN ('CANCELLED','CANCELED')) > 0
       ) g`,
  );
  report(mixed[0].read_cancelled === 0, 'Operation/shipment groups with a cancelled and an active member do not read CANCELLED', `${mixed[0].n} mixed groups`);

  // 7. shipment of contract 1004031718 restored earlier on prod must not be cancelled
  const restored = await q(
    `SELECT s.status, COUNT(*)::int AS n FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE c.contract_id = '1004031718' GROUP BY s.status`,
  );
  const cancelledRestored = restored.filter((r) => /^cancel/i.test(r.status || '')).reduce((a, r) => a + r.n, 0);
  report(
    restored.length > 0 && cancelledRestored === 0,
    'contract 1004031718 has no cancelled shipment',
    restored.map((r) => `${r.status}:${r.n}`).join(' '),
  );

  // 8. JPS sync cron must stay off in prod (release notes: DHM and JPS crons left off)
  console.log('\nNot checked here: "Crons registered" has no "JPS sync cron scheduled" - read it in the deploy output / backend log.');

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  await connection.end?.();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('verify failed:', e);
  process.exit(1);
});
