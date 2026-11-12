/*
 * READ-ONLY: which SAP row does each shipment of an operation take its ports and dates from, and what port plan does that give?
 *
 *   cat docs/scripts/diag-sap-row-for-shipment.cjs | docker exec -i -e OP=OP-1004030473-49138234 klip-backend node -
 *
 * Needs the build that has resolveLatestSapRowForShipment (the own-STO fix of 2026-11-12). On the build before it, the shipments of a manual STO come back "own" with the
 * OLD voyage's row and a plan whose discharge row carries its ATC; after it they come back as a fallback and the plan carries port names only.
 */
const pool = require('./dist/database/connection').default;
const svc = require('./dist/services/vesselLoadingPortsFromSap.service');
const OP = process.env.OP || 'OP-1004030473-49138234';

(async () => {
  if (typeof svc.resolveLatestSapRowForShipment !== 'function') {
    console.log('this build predates the own-STO fix (resolveLatestSapRowForShipment is missing): nothing to compare');
    process.exit(0);
  }
  const ships = (await pool.query(
    `SELECT s.id, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, c.sto_number AS contract_sto
       FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE s.operation_id = $1 ORDER BY c.po_number`, [OP])).rows;
  console.log(`operation ${OP}: ${ships.length} shipments`);
  for (const s of ships) {
    const r = await svc.resolveLatestSapRowForShipment(s.id);
    const raw = (r && r.data && r.data.raw) || {};
    const plan = await svc.buildVesselLoadingPortsPlanForShipment(s.id);
    const discharge = plan.find((p) => p.is_discharge_port === true);
    const dated = plan.filter((p) => Object.entries(p).some(([k, v]) => /^(ata|eta)_/.test(k) && v));
    console.log(' ', JSON.stringify({
      po: s.po, sto: s.sto, contract_sto: s.contract_sto,
      resolved_from_own_sto: r ? r.ownStoMatch : null,
      resolved_row_sto: r ? (raw['STO No'] || null) : null,
      plan_ports: plan.map((p) => p.port_name),
      discharge_ata_in_plan: discharge ? discharge.ata_loading_completed : null,
      port_rows_with_any_date: dated.length,
    }));
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
