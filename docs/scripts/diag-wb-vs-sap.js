/*
 * READ-ONLY: how much taking the LARGER of WB and SAP would change the trucking quantities.
 *
 * qty_move prefers the weighbridge whenever it has any figure at all:
 *
 *     WHEN w.wb_delivery_qty_kg > 0 THEN w.wb_delivery_qty_kg
 *     ELSE s.quantity_delivery_trucking
 *
 * so a WB total that lags SAP holds the outstanding quantity artificially high. Taking
 * GREATEST(wb, sap) instead would release that difference and let operations reach Complete once
 * outstanding falls inside the 499 kg band.
 *
 * The overlay only applies to FRC/LCO contracts whose GR is still open (GR STO for LCO, GR PO for
 * FRC), with a live, non-deduped trucking operation - so the figures that matter are the ones
 * inside that scope. Measured without it, the gap looks enormous and is mostly contracts whose GR
 * has closed, where SAP is already the source and nothing would change.
 *
 *   node /app/diag-wb-vs-sap.js
 */
const connection = require('/app/dist/database/connection');
const { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } = require('/app/dist/utils/truckingWbActualSumSql');
const { sqlIsContractSapClosedExpr } = require('/app/dist/utils/contractDeliveryStatus');

const mt = (kg) => Math.round(Number(kg || 0)).toLocaleString('en-US');

(async () => {
  const del = sqlWbActualDeliverySumKg('t.id');
  const rec = sqlWbActualReceiveSumKg('t.id');
  const grClosed = sqlIsContractSapClosedExpr('c');

  const inner = (extraWhere) => `
    SELECT c.contract_id,
           COALESCE(SUM(${del}), 0)::numeric                  AS wb_del,
           COALESCE(SUM(${rec}), 0)::numeric                  AS wb_rec,
           COALESCE(MAX(qms.quantity_delivery), 0)::numeric   AS sap_del,
           COALESCE(MAX(qms.quantity_receive), 0)::numeric    AS sap_rec,
           GREATEST(COALESCE(c.quantity_ordered, 0) - COALESCE(SUM(${rec}), 0), 0) AS os_now,
           GREATEST(COALESCE(c.quantity_ordered, 0)
                    - GREATEST(COALESCE(SUM(${rec}), 0), COALESCE(MAX(qms.quantity_receive), 0)), 0) AS os_new
    FROM contracts c
    JOIN trucking_operations t ON t.contract_id = c.id
    LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
    WHERE UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'LCO')
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      AND t.deduped_at IS NULL
      ${extraWhere}
    GROUP BY c.contract_id, c.quantity_ordered`;

  const summarise = async (label, extraWhere) => {
    const res = await connection.query(`
      SELECT COUNT(*)                                        AS contracts,
             COUNT(*) FILTER (WHERE wb_del < sap_del)        AS wb_delivery_behind,
             COUNT(*) FILTER (WHERE wb_rec < sap_rec)        AS wb_receive_behind,
             COALESCE(SUM(GREATEST(sap_del - wb_del, 0)), 0) AS delivery_gap_kg,
             COALESCE(SUM(GREATEST(sap_rec - wb_rec, 0)), 0) AS receive_gap_kg,
             COUNT(*) FILTER (WHERE os_now > 499 AND os_new <= 499) AS becomes_complete,
             COALESCE(SUM(GREATEST(os_now - os_new, 0)), 0)  AS os_released_kg
      FROM (${inner(extraWhere)}) x
      WHERE wb_del > 0 OR wb_rec > 0`);
    const r = res.rows[0];
    console.log(`\n${label}`);
    console.log(`   contracts with WB figures   : ${r.contracts}`);
    console.log(`   WB delivery behind SAP      : ${r.wb_delivery_behind}   gap ${mt(r.delivery_gap_kg / 1000)} MT`);
    console.log(`   WB receive behind SAP       : ${r.wb_receive_behind}   gap ${mt(r.receive_gap_kg / 1000)} MT`);
    console.log(`   would reach Complete        : ${r.becomes_complete}`);
    console.log(`   outstanding released        : ${mt(r.os_released_kg / 1000)} MT`);
  };

  await summarise('A. inside the overlay scope - what the change would actually do:', `AND NOT (${grClosed})`);
  await summarise('B. every FRC/LCO contract, for contrast - most of this is GR-closed, where SAP is already used and nothing changes:', '');

  const rows = await connection.query(`
    SELECT contract_id, ROUND(wb_rec / 1000) AS wb_receive_mt, ROUND(sap_rec / 1000) AS sap_receive_mt,
           ROUND(os_now / 1000) AS os_now_mt, ROUND(os_new / 1000) AS os_after_mt
    FROM (${inner(`AND NOT (${grClosed})`)}) x
    WHERE (wb_del > 0 OR wb_rec > 0) AND (wb_rec < sap_rec OR wb_del < sap_del)
    ORDER BY (sap_rec - wb_rec) DESC LIMIT 20`);
  console.log(`\nC. the contracts that would change (top ${rows.rows.length}):`);
  if (!rows.rows.length) console.log('   (none)');
  for (const r of rows.rows) {
    console.log(`   ${String(r.contract_id).padEnd(12)} WB ${String(r.wb_receive_mt).padStart(6)} MT  SAP ${String(r.sap_receive_mt).padStart(6)} MT  OS ${String(r.os_now_mt).padStart(6)} -> ${r.os_after_mt} MT`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
