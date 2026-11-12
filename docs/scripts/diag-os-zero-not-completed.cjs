/*
 * READ-ONLY: POs whose outstanding is inside the zero band (<= 499 kg, from contract_qty_move_snapshot, the same expression the old Shipments rule read) but whose shipment is
 * NOT finished by GR Close or by an ATC. These are the rows the Shipments page used to show as Completed through the removed "OS = 0" arm and now shows by their milestones.
 *
 *   cat docs/scripts/diag-os-zero-not-completed.cjs | docker exec -i klip-backend node -
 *
 * Approximations, stated: the ATC is the stored / override date (the JPS lane and the discharge port's own ATC are not read), and the group rule (every contract of the STO within
 * the band) is shown per PO. Good for looking at examples, not for reproducing the page's count to the row.
 */
const pool = require('./dist/database/connection').default;
const { shipmentListContractOsWithinBandExpr } = require('./dist/utils/shipmentListFilters');
const { sqlContractOutstandingFromFields, sqlIncotermQuantityDeliveryCase } = require('./dist/utils/sapIncotermMetrics');
const { sqlIsContractSapClosedForStoExpr } = require('./dist/utils/contractDeliveryStatus');
const { OUTSTANDING_QTY_ZERO_TOLERANCE_KG } = require('./dist/utils/qtyZeroTolerance');

const incoterm = "COALESCE(c.incoterm, '')";
const delivery = sqlIncotermQuantityDeliveryCase(incoterm, 'qms.quantity_delivery_trucking', 'qms.quantity_delivery_vessel', "UPPER(TRIM(COALESCE(c.transport_mode, '')))");
const osKg = sqlContractOutstandingFromFields({
  contractQtyExpr: 'c.quantity_ordered', incotermExpr: incoterm, receiveExpr: 'qms.quantity_receive', deliveryExpr: `(${delivery})`, clampAtZero: true,
});
const band = shipmentListContractOsWithinBandExpr();
const grClosed = sqlIsContractSapClosedForStoExpr('c', "NULLIF(TRIM(s.shipment_id::text), '')");
const atc = 'COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete)';

const FROM = `
  FROM shipments s
  JOIN contracts c ON c.id = s.contract_id
  JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
  LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
 WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
   AND ${band}
   AND ${atc} IS NULL
   AND NOT COALESCE(${grClosed}, FALSE)`;

(async () => {
  console.log(`outstanding band: <= ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG} kg`);
  const total = (await pool.query(`SELECT COUNT(*)::int AS shipments, COUNT(DISTINCT c.contract_id)::int AS pos ${FROM}`)).rows[0];
  console.log('OS in the band, no ATC, GR not Close:', JSON.stringify(total));
  const byStatus = (await pool.query(`SELECT COALESCE(s.status, '(none)') AS stored_status, COUNT(*)::int AS n ${FROM} GROUP BY 1 ORDER BY 2 DESC`)).rows;
  console.log('by stored shipment status:', JSON.stringify(byStatus));

  const sample = (await pool.query(`
    SELECT c.contract_id AS contract, c.po_number AS po, s.shipment_id AS sto, c.incoterm, s.vessel_name AS vessel, s.status AS stored_status,
           ROUND((${osKg})::numeric, 0) AS os_kg, ROUND(c.quantity_ordered::numeric / 1000, 1) AS contract_mt,
           ROUND(COALESCE(qms.quantity_delivery_vessel, 0)::numeric / 1000, 1) AS deliv_vessel_mt,
           ROUND(COALESCE(qms.quantity_delivery_trucking, 0)::numeric / 1000, 1) AS deliv_trucking_mt,
           ROUND(COALESCE(qms.quantity_receive, 0)::numeric / 1000, 1) AS receive_mt,
           s.ata_arrival::date AS ata_arrival, s.ata_sailed::date AS ata_sailed, s.ata_discharge_start::date AS ata_disch_start
    ${FROM}
    ORDER BY s.status, c.contract_id DESC
    LIMIT 15`)).rows;
  console.log('\nsample (15):');
  for (const r of sample) console.log(' ', JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
