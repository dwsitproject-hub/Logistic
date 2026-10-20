/*
 * READ-ONLY: why does the sea row scope (Shipping Performance and Shipments) keep or drop the shipments of a contract?
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-sea-row-scope.cjs | docker exec -i klip-backend node - --contract=1004032444
 *
 * Both pages filter shipments with buildShipmentPageSeaRowScopeSql: the contract's effective incoterm must be CIF / FOB / CFR, and a FOB shipment on a
 * Type T STO (a trucking leg) is dropped unless SAP names a vessel on that STO. A contract Contract Performance counts as Open but that neither page has a
 * row for (SIT / production 2026-10-20, 1004032444, FOB, 6 STOs, one PLANNED shipment) is decided by one of those parts. This prints each part for each
 * shipment, the way the page evaluates it. Writes nothing.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { buildShipmentPageSeaRowScopeSql, shipmentResolvedStoTypeForNumberExpr, sqlSapStoHasVesselExpr, shipmentListStoKeyExpr } = dist('utils/shipmentStoTypeSql');
  const { buildShipmentPageSeaIncotermScopeSql } = dist('utils/shipmentIncotermScope');
  const { contractEffectiveIncotermExpr } = dist('utils/truckingIncotermScope');
  const { shippingPerfStoMetricsKeyExpr } = dist('utils/shippingPerformanceStoSql');

  const arg = process.argv.find((a) => a.startsWith('--contract='));
  const contract = (arg ? arg.slice('--contract='.length) : '').trim();
  if (!contract) {
    console.error('Needs --contract=<contract number>');
    process.exit(1);
  }
  const key = `(${shipmentListStoKeyExpr('c', 'l', 's')})::text`;
  const rows = (
    await pool.query(
      `SELECT s.id::text AS id, s.shipment_id, s.operation_id, s.status, s.vessel_name,
              (${contractEffectiveIncotermExpr('c')}) AS eff_incoterm,
              (${buildShipmentPageSeaIncotermScopeSql('c')}) AS in_sea_incoterm,
              ${key} AS list_key,
              (${shippingPerfStoMetricsKeyExpr('c', 's')}) AS sp_key,
              (${shipmentResolvedStoTypeForNumberExpr('c', key)}) AS sto_type,
              (${sqlSapStoHasVesselExpr('c', key)}) AS sap_names_vessel,
              (${buildShipmentPageSeaRowScopeSql('c', 'l', 's')}) AS row_scope
         FROM shipments s
         JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
        WHERE c.contract_id = $1
        ORDER BY s.created_at`,
      [contract],
    )
  ).rows;
  console.log(`contract ${contract}: ${rows.length} shipment(s)`);
  for (const r of rows) {
    console.log(`\n  shipment ${r.id.slice(0, 8)}  ${r.status}  vessel=${r.vessel_name || '-'}  shipment_id=${r.shipment_id}  operation=${r.operation_id || '-'}`);
    console.log(`    effective incoterm            ${r.eff_incoterm}   in CIF/FOB/CFR: ${r.in_sea_incoterm}`);
    console.log(`    list key / SP metrics key     ${r.list_key} / ${r.sp_key}`);
    console.log(`    resolved STO type of the key  ${r.sto_type}   SAP names a vessel on it: ${r.sap_names_vessel}`);
    console.log(`    ROW SCOPE (kept by the page)  ${r.row_scope}`);
  }
  const stos = (
    await pool.query(
      `SELECT cs.sto_number, cs.sto_type, cs.updated_at FROM contract_stos cs JOIN contracts c ON c.id = cs.contract_id WHERE c.contract_id = $1 ORDER BY cs.updated_at DESC NULLS LAST`,
      [contract],
    )
  ).rows;
  console.log(`\n  contract_stos (${stos.length}): ` + stos.map((s) => `${s.sto_number}[${s.sto_type || '-'}]`).join('  '));
  await pool.end();
})().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
