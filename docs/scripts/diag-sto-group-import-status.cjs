/*
 * READ-ONLY: how do Shipping Performance and Shipments read the SAP import status of ONE STO group, member by member?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-sto-group-import-status.cjs | docker exec -i klip-backend node - --sto=1016011366
 *
 * Built for KARAWANG (production 2026-10-20): the four-page diagnostic reads Contract Performance and Shipments 85,900 MT and Shipping Performance 86,012.1 MT.
 * The 112.1 MT is contract 1014003192 on STO 1016011366, a group of five contracts. Shipments reads the group COMPLETED (is_contract_sap_closed = true: BOOL_AND of
 * "closed" over the members, key = the list STO key); Shipping Performance reads the row's import_status as "Cancelled" (aggregateImportStatusForStoGroup over the
 * members, key = shippingPerfStoMetricsKeyExpr), so the row is not finished and sits at UNLOADING. Both read the same sqlContractImportStatusExpr; they differ in
 * the KEY handed to it and in WHICH shipments count as members. This prints, for every shipment of a contract that touches the STO, the status under each key and
 * whether the shipment is cancelled, so the member that makes the two disagree is the one that shows.
 *
 * Writes nothing.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { sqlContractImportStatusExpr, sqlIsContractSapClosedForStoExpr } = dist('utils/contractDeliveryStatus');
  const { shippingPerfStoMetricsKeyExpr } = dist('utils/shippingPerformanceStoSql');
  const { shipmentListSeaStoKeyExpr } = dist('utils/shipmentStoTypeSql');

  const arg = process.argv.find((a) => a.startsWith('--sto='));
  const sto = (arg ? arg.slice('--sto='.length) : '').trim();
  if (!sto) {
    console.error('Needs --sto=<STO number>');
    process.exit(1);
  }
  const spKey = `(${shippingPerfStoMetricsKeyExpr('c', 's')})::text`;
  const listKey = `(${shipmentListSeaStoKeyExpr('c', 'l', 's')})::text`;

  const r = await pool.query(
    `SELECT c.contract_id, c.po_number, c.status AS contract_status, s.id::text AS shipment_uuid, s.shipment_id, s.operation_id, s.status AS shipment_status,
            ${spKey} AS sp_key,
            (${sqlContractImportStatusExpr('c', 'c.po_number', spKey)}) AS sp_import_status,
            ${listKey} AS list_key,
            (${sqlContractImportStatusExpr('c', 'c.po_number', listKey)}) AS list_import_status,
            (${sqlIsContractSapClosedForStoExpr('c', listKey)}) AS list_closed
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE ${spKey} = $1 OR ${listKey} = $1
         OR c.id IN (SELECT s2.contract_id FROM shipments s2 WHERE TRIM(s2.shipment_id::text) = $1)
      ORDER BY c.contract_id, s.created_at`,
    [sto],
  );
  console.log(`STO ${sto}: ${r.rows.length} shipment(s) on its contracts\n`);
  console.log('contract      contract st  shipment st   sp key / import status        list key / import status      list closed');
  for (const x of r.rows) {
    console.log(
      String(x.contract_id).padEnd(14) + String(x.contract_status || '-').padEnd(13) + String(x.shipment_status || '-').padEnd(14) +
        (`${x.sp_key || '-'} / ${x.sp_import_status || '-'}`).padEnd(30) + (`${x.list_key || '-'} / ${x.list_import_status || '-'}`).padEnd(30) + String(x.list_closed),
    );
  }
  const live = r.rows.filter((x) => !['CANCELLED', 'CANCELED'].includes(String(x.shipment_status || '').toUpperCase()));
  const statusesAll = r.rows.map((x) => String(x.sp_import_status || '').trim());
  const statusesLive = live.map((x) => String(x.sp_import_status || '').trim());
  console.log(`\nSP-key statuses, every shipment : ${[...new Set(statusesAll)].join(' | ') || '-'}`);
  console.log(`SP-key statuses, live shipments  : ${[...new Set(statusesLive)].join(' | ') || '-'}`);
  console.log(`list BOOL_AND(closed), every shipment: ${r.rows.length > 0 && r.rows.every((x) => x.list_closed === true)}   live only: ${live.length > 0 && live.every((x) => x.list_closed === true)}`);
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
