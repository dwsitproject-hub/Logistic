/*
 * READ-ONLY: what taking the LARGER of WB and SAP actually changed, for OPEN contracts.
 *
 * Run it with a contract number or an STO number to inspect one case:
 *   node /app/diag-wb-vs-sap.js
 *   node /app/diag-wb-vs-sap.js 1366001065
 *
 * The rule BEFORE, in sqlTruckingResolvedReceiveQty / ...DeliveryQty:
 *
 *     WHEN (has WB rows) AND NOT (GR closed) AND (wb sum) > 0 THEN wb sum
 *     WHEN (GR closed)                                        THEN sap
 *     ELSE COALESCE(sap, inner, 0)
 *
 * so a single weighbridge ticket discarded SAP entirely for as long as GR stayed open. The first
 * branch now reads GREATEST(wb, COALESCE(sap, 0)).
 *
 * TWO MISTAKES THIS SCRIPT HAS ALREADY MADE, both recorded because both are easy to repeat.
 *
 * 1. It read contract_qty_move_snapshot directly and concluded the change would affect nothing.
 *    The application reads SAP through sqlSapQtyDeliveryOnly / sqlSapQtyReceiveOnly, which are an
 *    OVERLAY - live sap_processed_data first, the snapshot only as a fallback. That snapshot is
 *    built for Close contracts and is empty for the Open ones that are this question's entire
 *    scope, so SAP measured as 0 everywhere and could never exceed WB.
 *
 * 2. After the change shipped, it built its "before" side by calling the same library functions
 *    the pages call - which by then already contained the new rule. Both sides were identical and
 *    the delta was 0 by construction, not by measurement. The old CASE is therefore written out
 *    by hand below and will stay written out: a baseline that imports the thing it is a baseline
 *    for is not a baseline.
 */
const connection = require('/app/dist/database/connection');
const {
  sqlTruckingResolvedDeliveryQty,
  sqlTruckingResolvedReceiveQty,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingHasDailyActualsExpr,
  sqlSapQtyDeliveryOnly,
  sqlSapQtyReceiveOnly,
} = require('/app/dist/utils/truckingQuantitySql');
const { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } = require('/app/dist/utils/truckingWbActualSumSql');
const { sqlIsContractSapClosedExpr } = require('/app/dist/utils/contractDeliveryStatus');

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const LOOKUP = (process.argv[2] || '').trim();

(async () => {
  const sapDel = sqlSapQtyDeliveryOnly();
  const sapRec = sqlSapQtyReceiveOnly();
  const wbDel = sqlWbActualDeliverySumKg('t.id');
  const wbRec = sqlWbActualReceiveSumKg('t.id');
  const grClosed = sqlIsContractSapClosedExpr('c');
  const hasWb = sqlTruckingHasDailyActualsExpr('t.id');
  const inner = 'COALESCE(t.quantity_delivered, 0)';

  // The rule as it stood before the change - written out, never imported. See note 2 above.
  const oldRule = (wb, sap) => `CASE
    WHEN (${hasWb}) AND NOT (${grClosed}) AND (${wb}) > 0 THEN ${wb}
    WHEN (${grClosed}) THEN COALESCE(${sap}, 0)
    ELSE COALESCE(${sap}, ${inner}, 0)
  END`;

  const osOld = sqlTruckingOutstandingQtyByIncoterm(
    oldRule(wbDel, sapDel), oldRule(wbRec, sapRec),
    'COALESCE(c.quantity_ordered, 0)', 'c.incoterm');
  const osNew = sqlTruckingOutstandingQtyByIncoterm(
    sqlTruckingResolvedDeliveryQty(inner, sapDel, 't.id', 'c'),
    sqlTruckingResolvedReceiveQty(inner, sapRec, 't.id', 'c'),
    'COALESCE(c.quantity_ordered, 0)', 'c.incoterm');

  console.log('scanning (one pass, materialised)...');
  await connection.query(`
    CREATE TEMP TABLE wbsap AS
    SELECT c.contract_id,
           c.sto_number,
           c.incoterm,
           t.operation_id,
           COALESCE(c.quantity_ordered, 0)::numeric AS ordered_kg,
           (${wbDel})::numeric   AS wb_del,
           (${wbRec})::numeric   AS wb_rec,
           (${sapDel})::numeric  AS sap_del,
           (${sapRec})::numeric  AS sap_rec,
           (${grClosed})         AS gr_closed,
           (${osOld})::numeric   AS os_old,
           (${osNew})::numeric   AS os_new
    FROM contracts c
    JOIN trucking_operations t ON t.contract_id = c.id
    WHERE UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'LCO')
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      AND t.deduped_at IS NULL`);

  const summarise = async (label, where) => {
    const r = (await connection.query(`
      SELECT COUNT(*)                                               AS operations,
             COUNT(*) FILTER (WHERE wb_del < sap_del)               AS wb_delivery_behind,
             COUNT(*) FILTER (WHERE wb_rec < sap_rec)               AS wb_receive_behind,
             COUNT(*) FILTER (WHERE os_new < os_old)                AS os_fell,
             COUNT(*) FILTER (WHERE os_new > os_old)                AS os_rose,
             COUNT(*) FILTER (WHERE os_old > 499 AND os_new <= 499) AS became_complete,
             COALESCE(SUM(GREATEST(os_old - os_new, 0)), 0)         AS os_released_kg
      FROM wbsap WHERE ${where}`)).rows[0];
    console.log(`\n${label}`);
    console.log(`   trucking operations         : ${r.operations}`);
    console.log(`   WB delivery behind SAP      : ${r.wb_delivery_behind}`);
    console.log(`   WB receive behind SAP       : ${r.wb_receive_behind}`);
    console.log(`   outstanding fell            : ${r.os_fell}`);
    console.log(`   outstanding ROSE            : ${r.os_rose}   <- must be 0; GREATEST cannot lower a figure`);
    console.log(`   reached Complete            : ${r.became_complete}`);
    console.log(`   outstanding released        : ${mt(r.os_released_kg)} MT`);
  };

  await summarise('A. GR still open - the only place the change does anything:', 'NOT gr_closed');
  await summarise('B. GR closed, for contrast - SAP is already the source, so every line must read 0:', 'gr_closed');

  const rows = (await connection.query(`
    SELECT contract_id, incoterm,
           ROUND(wb_del / 1000, 2) AS wb_del_mt, ROUND(sap_del / 1000, 2) AS sap_del_mt,
           ROUND(wb_rec / 1000, 2) AS wb_rec_mt, ROUND(sap_rec / 1000, 2) AS sap_rec_mt,
           ROUND(os_old / 1000, 1) AS os_old_mt, ROUND(os_new / 1000, 1) AS os_new_mt
    FROM wbsap
    WHERE NOT gr_closed AND os_new < os_old
    ORDER BY (os_old - os_new) DESC LIMIT 25`)).rows;
  console.log(`\nC. the operations that changed (top ${rows.length}):`);
  if (!rows.length) console.log('   (none)');
  else console.log('   contract      inc    WB del   SAP del    WB rec   SAP rec       OS was -> OS now');
  for (const r of rows) {
    console.log('   ' + String(r.contract_id).padEnd(13) + String(r.incoterm).padEnd(6) +
      String(r.wb_del_mt).padStart(9) + String(r.sap_del_mt).padStart(10) +
      String(r.wb_rec_mt).padStart(10) + String(r.sap_rec_mt).padStart(10) + '   ' +
      String(r.os_old_mt).padStart(9) + ' -> ' + r.os_new_mt + ' MT');
  }

  // Contracts where SAP is ahead but outstanding did NOT move. Not a failure - LCO measures
  // outstanding against DELIVERY and FRC against RECEIVE, so a gap on the other side changes
  // nothing - but it is the first thing to look at when a case does not behave as expected.
  const inert = (await connection.query(`
    SELECT COUNT(*) AS n FROM wbsap
    WHERE NOT gr_closed AND (wb_del < sap_del OR wb_rec < sap_rec) AND os_new >= os_old`)).rows[0];
  console.log(`\n   SAP ahead but outstanding unchanged: ${inert.n}`);
  console.log('   (expected for a gap on the side the incoterm does not measure:');
  console.log('    LCO counts delivery, FRC counts receive)');

  if (LOOKUP) {
    console.log(`\nD. lookup "${LOOKUP}" (matched on contract number or STO number):`);
    const one = (await connection.query(`
      SELECT contract_id, sto_number, operation_id, incoterm, gr_closed,
             ROUND(ordered_kg / 1000, 2) AS ordered_mt,
             ROUND(wb_del / 1000, 2) AS wb_del_mt, ROUND(sap_del / 1000, 2) AS sap_del_mt,
             ROUND(wb_rec / 1000, 2) AS wb_rec_mt, ROUND(sap_rec / 1000, 2) AS sap_rec_mt,
             ROUND(os_old / 1000, 1) AS os_old_mt, ROUND(os_new / 1000, 1) AS os_new_mt
      FROM wbsap
      WHERE contract_id = $1 OR TRIM(COALESCE(sto_number::text, '')) = $1
         OR TRIM(COALESCE(operation_id::text, '')) = $1`, [LOOKUP])).rows;
    if (!one.length) console.log('   (no FRC/LCO trucking operation matches that number)');
    for (const r of one) {
      console.log(`   contract ${r.contract_id}  STO ${r.sto_number || '-'}  ${r.operation_id || '-'}`);
      console.log(`   ${r.incoterm}  ordered ${r.ordered_mt} MT  GR closed=${r.gr_closed}`);
      console.log(`   delivery  WB ${r.wb_del_mt} MT  vs SAP ${r.sap_del_mt} MT`);
      console.log(`   receive   WB ${r.wb_rec_mt} MT  vs SAP ${r.sap_rec_mt} MT`);
      console.log(`   outstanding ${r.os_old_mt} MT  ->  ${r.os_new_mt} MT`);
    }
  } else {
    console.log('\nD. pass a contract or STO number as an argument to inspect one case.');
  }

  await connection.query('DROP TABLE IF EXISTS wbsap');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
