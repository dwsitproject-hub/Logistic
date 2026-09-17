/*
 * READ-ONLY: how much taking the LARGER of WB and SAP would change the trucking quantities,
 * for OPEN contracts only - the only place where the two disagree in a way that matters.
 *
 * The rule today, in sqlTruckingResolvedReceiveQty / ...DeliveryQty:
 *
 *     WHEN (has WB rows) AND NOT (GR closed) AND (wb sum) > 0 THEN wb sum
 *     WHEN (GR closed)                                        THEN sap
 *     ELSE COALESCE(sap, inner, 0)
 *
 * so a single weighbridge ticket is enough to discard SAP entirely while GR is open. Contract
 * 1004031065 (LCO, 100 MT, STO 1366001065) is the shape that matters: WB has two tickets totalling
 * 0.09 MT, SAP has 89.74 MT received. Outstanding reads 100 MT; from SAP it would be ~10 MT.
 *
 * THE FIRST VERSION OF THIS SCRIPT SAID THE CHANGE WOULD AFFECT NOTHING. It was wrong, and the
 * mistake is worth recording because it is easy to repeat: it read contract_qty_move_snapshot
 * directly, but the application reads SAP through sqlSapQtyDeliveryOnly / sqlSapQtyReceiveOnly,
 * which are an OVERLAY - the live sap_processed_data subquery first, the snapshot only as a
 * fallback. That snapshot is built for Close contracts; for the Open contracts that are the entire
 * scope of this question it is empty. So SAP read as 0 everywhere, never exceeded WB, and the
 * answer came back "0 contracts" for a reason that had nothing to do with the data.
 *
 * This version composes the same expressions the pages compose, and measures outstanding quantity
 * by incoterm the same way too (LCO: contract - delivery, FRC: contract - receive).
 *
 *   node /app/diag-wb-vs-sap.js
 */
const connection = require('/app/dist/database/connection');
const {
  sqlTruckingResolvedDeliveryQty,
  sqlTruckingResolvedReceiveQty,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlSapQtyDeliveryOnly,
  sqlSapQtyReceiveOnly,
} = require('/app/dist/utils/truckingQuantitySql');
const { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } = require('/app/dist/utils/truckingWbActualSumSql');
const { sqlIsContractSapClosedExpr } = require('/app/dist/utils/contractDeliveryStatus');

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });

(async () => {
  const sapDel = sqlSapQtyDeliveryOnly();
  const sapRec = sqlSapQtyReceiveOnly();
  const wbDel = sqlWbActualDeliverySumKg('t.id');
  const wbRec = sqlWbActualReceiveSumKg('t.id');
  const grClosed = sqlIsContractSapClosedExpr('c');

  const curDel = sqlTruckingResolvedDeliveryQty('COALESCE(t.quantity_delivered, 0)', sapDel, 't.id', 'c');
  const curRec = sqlTruckingResolvedReceiveQty('COALESCE(t.quantity_delivered, 0)', sapRec, 't.id', 'c');

  // The proposed change, expressed exactly as it would be implemented: the WB branch takes the
  // larger of the two instead of WB alone. Every other branch is untouched, so a GR-closed
  // contract - which already reads SAP - cannot move.
  const newDel = sqlTruckingResolvedDeliveryQty('COALESCE(t.quantity_delivered, 0)', sapDel, 't.id', 'c', {
    wbQtyExpr: `GREATEST(${wbDel}, COALESCE(${sapDel}, 0))`,
  });
  const newRec = sqlTruckingResolvedReceiveQty('COALESCE(t.quantity_delivered, 0)', sapRec, 't.id', 'c', {
    wbQtyExpr: `GREATEST(${wbRec}, COALESCE(${sapRec}, 0))`,
  });

  const osNow = sqlTruckingOutstandingQtyByIncoterm(curDel, curRec, 'COALESCE(c.quantity_ordered, 0)', 'c.incoterm');
  const osNew = sqlTruckingOutstandingQtyByIncoterm(newDel, newRec, 'COALESCE(c.quantity_ordered, 0)', 'c.incoterm');

  // These expressions render to hundreds of KB each. Evaluate them once into a temp table rather
  // than re-embedding them in every question asked of them.
  console.log('scanning (one pass, materialised)...');
  await connection.query(`
    CREATE TEMP TABLE wbsap AS
    SELECT c.contract_id,
           c.incoterm,
           COALESCE(c.quantity_ordered, 0)::numeric AS ordered_kg,
           (${wbDel})::numeric   AS wb_del,
           (${wbRec})::numeric   AS wb_rec,
           (${sapDel})::numeric  AS sap_del,
           (${sapRec})::numeric  AS sap_rec,
           (${grClosed})         AS gr_closed,
           (${osNow})::numeric   AS os_now,
           (${osNew})::numeric   AS os_new
    FROM contracts c
    JOIN trucking_operations t ON t.contract_id = c.id
    WHERE UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'LCO')
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      AND t.deduped_at IS NULL
      -- Without a weighbridge row the WB branch cannot fire at all, so os_new = os_now by
      -- construction. Excluding those keeps a 326 KB statement off rows that cannot answer anything.
      AND EXISTS (SELECT 1 FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id)`);

  const summarise = async (label, where) => {
    const r = (await connection.query(`
      SELECT COUNT(*)                                               AS operations,
             COUNT(*) FILTER (WHERE wb_del < sap_del)               AS wb_delivery_behind,
             COUNT(*) FILTER (WHERE wb_rec < sap_rec)               AS wb_receive_behind,
             COUNT(*) FILTER (WHERE os_new < os_now)                AS os_would_fall,
             COUNT(*) FILTER (WHERE os_now > 499 AND os_new <= 499) AS becomes_complete,
             COALESCE(SUM(GREATEST(os_now - os_new, 0)), 0)         AS os_released_kg
      FROM wbsap WHERE ${where}`)).rows[0];
    console.log(`\n${label}`);
    console.log(`   trucking operations (with WB): ${r.operations}`);
    console.log(`   WB delivery behind SAP      : ${r.wb_delivery_behind}`);
    console.log(`   WB receive behind SAP       : ${r.wb_receive_behind}`);
    console.log(`   outstanding would fall      : ${r.os_would_fall}`);
    console.log(`   would reach Complete        : ${r.becomes_complete}   <- the number that matters`);
    console.log(`   outstanding released        : ${mt(r.os_released_kg)} MT`);
  };

  await summarise('A. GR still open - the only place the change does anything:', 'NOT gr_closed');
  await summarise('B. GR closed, for contrast - SAP is already the source here, so this must read 0:', 'gr_closed');

  const rows = (await connection.query(`
    SELECT contract_id, incoterm,
           ROUND(wb_del / 1000, 2) AS wb_del_mt, ROUND(sap_del / 1000, 2) AS sap_del_mt,
           ROUND(wb_rec / 1000, 2) AS wb_rec_mt, ROUND(sap_rec / 1000, 2) AS sap_rec_mt,
           ROUND(os_now / 1000, 1) AS os_now_mt, ROUND(os_new / 1000, 1) AS os_new_mt
    FROM wbsap
    WHERE NOT gr_closed AND os_new < os_now
    ORDER BY (os_now - os_new) DESC LIMIT 25`)).rows;
  console.log(`\nC. the contracts that would change (top ${rows.length}):`);
  if (!rows.length) console.log('   (none)');
  else console.log('   contract      inc    WB del   SAP del    WB rec   SAP rec      OS now -> OS after');
  for (const r of rows) {
    console.log('   ' + String(r.contract_id).padEnd(13) + String(r.incoterm).padEnd(6) +
      String(r.wb_del_mt).padStart(9) + String(r.sap_del_mt).padStart(10) +
      String(r.wb_rec_mt).padStart(10) + String(r.sap_rec_mt).padStart(10) + '   ' +
      String(r.os_now_mt).padStart(9) + ' -> ' + r.os_new_mt + ' MT');
  }

  console.log('\nD. the contract this started from, 1004031065:');
  const one = (await connection.query(`
    SELECT incoterm, gr_closed,
           ROUND(wb_del / 1000, 2) AS wb_del_mt, ROUND(sap_del / 1000, 2) AS sap_del_mt,
           ROUND(wb_rec / 1000, 2) AS wb_rec_mt, ROUND(sap_rec / 1000, 2) AS sap_rec_mt,
           ROUND(os_now / 1000, 1) AS os_now_mt, ROUND(os_new / 1000, 1) AS os_new_mt
    FROM wbsap WHERE contract_id = '1004031065'`)).rows;
  if (!one.length) console.log('   (not in scope - check the contract number)');
  for (const r of one) {
    console.log(`   ${r.incoterm}  GR closed=${r.gr_closed}  WB del ${r.wb_del_mt} / SAP del ${r.sap_del_mt} MT` +
      `  WB rec ${r.wb_rec_mt} / SAP rec ${r.sap_rec_mt} MT   OS ${r.os_now_mt} -> ${r.os_new_mt} MT`);
  }

  await connection.query('DROP TABLE IF EXISTS wbsap');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
