/*
 * READ-ONLY: trucking operations whose outstanding quantity is already inside the zero band but
 * which are not showing as Completed.
 *
 * The rule exists: isTruckingPipelineCompleted is "GR closed OR outstanding <= 499 kg", so an
 * operation that has received everything should reach COMPLETED even while GR is still open. This
 * asks whether it actually does - and where it does not, which of the two inputs is at fault.
 *
 * Written after measuring a different idea and finding it would change nothing: taking the larger
 * of the weighbridge and SAP figures, which sounded like it would release stuck outstanding
 * quantity, turned out to apply to 0 of 286 in-scope contracts in production, because while GR is
 * open SAP has not caught up yet - GR closing IS SAP catching up.
 *
 *   node /app/diag-trucking-stuck-complete.js
 */
const connection = require('/app/dist/database/connection');
const { sqlTruckingListBaseOutstandingQtyExpr } = require('/app/dist/utils/truckingQuantitySql');
const { sqlTruckingEffectiveStatus } = require('/app/dist/utils/truckingEffectiveStatus');
const { sqlContractImportStatusExpr } = require('/app/dist/utils/contractDeliveryStatus');

const mt = (kg) => Math.round(Number(kg || 0) / 1000).toLocaleString('en-US');

(async () => {
  const os = sqlTruckingListBaseOutstandingQtyExpr('c');
  const eff = sqlTruckingEffectiveStatus('c', undefined, os);
  const gr = sqlContractImportStatusExpr('c');

  const base = `
    FROM trucking_operations t
    JOIN contracts c ON c.id = t.contract_id
    WHERE UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      AND t.deduped_at IS NULL`;

  // The effective-status expression renders to ~335 KB of SQL and already contains the
  // outstanding-quantity expression inside it. Embedding either one twice makes the planner do the
  // whole job twice for nothing, so evaluate once into a temp table and ask that.
  console.log('scanning (one pass, materialised)...');
  await connection.query(`
    CREATE TEMP TABLE stuck_scan AS
    SELECT c.contract_id, t.operation_id, t.status AS stored,
           (${os})::numeric AS os_kg, (${eff}) AS effective, (${gr}) AS gr_status,
           ROUND(COALESCE(c.quantity_ordered, 0) / 1000) AS ordered_mt
    ${base}`);

  const summary = await connection.query(`
    SELECT COUNT(*)                                                     AS operations,
           COUNT(*) FILTER (WHERE os_kg <= 499)                         AS os_within_band,
           COUNT(*) FILTER (WHERE os_kg <= 499 AND effective <> 'COMPLETED') AS band_but_not_completed,
           COUNT(*) FILTER (WHERE os_kg IS NULL)                        AS os_unknown,
           COUNT(*) FILTER (WHERE effective = 'COMPLETED')              AS effective_completed,
           COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(stored, ''))) = 'COMPLETED') AS stored_completed,
           COUNT(*) FILTER (WHERE effective = 'COMPLETED'
                            AND UPPER(TRIM(COALESCE(stored, ''))) <> 'COMPLETED')  AS effective_ahead_of_stored
    FROM stuck_scan`);
  const s = summary.rows[0];
  console.log('\noperations (live, not cancelled, not deduped):');
  console.log(`   total                                : ${s.operations}`);
  console.log(`   outstanding within the 499 kg band   : ${s.os_within_band}`);
  console.log(`   ... of those, NOT showing Completed  : ${s.band_but_not_completed}   <- the stuck ones`);
  console.log(`   outstanding unknown (NULL)           : ${s.os_unknown}`);
  console.log(`   effective status COMPLETED           : ${s.effective_completed}`);
  console.log(`   stored status COMPLETED              : ${s.stored_completed}`);
  console.log(`   computed Completed, stored not       : ${s.effective_ahead_of_stored}`);

  const stuck = await connection.query(`
    SELECT contract_id, operation_id, stored, ROUND(os_kg) AS os_kg, effective, gr_status, ordered_mt
    FROM stuck_scan
    WHERE os_kg <= 499 AND effective <> 'COMPLETED'
    ORDER BY ordered_mt DESC LIMIT 25`);
  console.log(`\nthe stuck operations (top ${stuck.rows.length}):`);
  if (!stuck.rows.length) {
    console.log('   (none - the rule is firing everywhere it should)');
  } else {
    console.log('   contract      operation            stored        effective     GR      OS kg  ordered');
    for (const r of stuck.rows) {
      console.log('   ' + String(r.contract_id).padEnd(13) + String(r.operation_id || '-').padEnd(21) +
        String(r.stored || '-').padEnd(14) + String(r.effective).padEnd(14) +
        String(r.gr_status || '-').padEnd(8) + String(r.os_kg).padStart(6) + '  ' + r.ordered_mt + ' MT');
    }
  }

  await connection.query('DROP TABLE IF EXISTS stuck_scan');

  console.log('\nRead it as: "NOT showing Completed" is the number worth acting on. If it is 0 the rule');
  console.log('already works and outstanding quantity is being held by something other than the status.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
