/**
 * READ-ONLY. Why does one STO row in Contract Details show a Delivery Qty 1000x too large (171,580 MT instead of 172 MT)?
 *
 * Two code paths can inflate it and the screen cannot say which one it was:
 *   A. the SAP "delivered" value is run through sqlNormalizeSapStoQtyToKgSql, which multiplies by 1000 whenever the raw value is <= 1% of
 *      the contract quantity (it assumes a value that small is in MT). A real 171,580 kg delivery on a 40,000 MT contract is 0.43%.
 *   B. the weighbridge sum (trucking_daily_actuals.quantity_delivery_kg) is itself too large, and the row shows GREATEST(WB, SAP).
 *
 * Needs no deploy: it calls the code ALREADY inside the running backend image (dist/).
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-sto-delivery-qty.cjs \
 *     | docker exec -i klip-backend node - --operation=OP-LAND-081020260019
 *
 * Give --operation=<Operation ID> or --contract=<contract number / PO>. Nothing is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const mt = (kg) => (num(kg) == null ? '-' : `${(num(kg) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} MT`);

(async () => {
  const operation = arg('operation');
  const contract = arg('contract');
  if (!operation && !contract) {
    console.error('Give --operation=<Operation ID> or --contract=<contract number>.');
    process.exit(1);
  }
  const pool = dist('database/connection').default;
  const { sqlSapQtyDeliveredAnyFromSpd } = dist('utils/contractLogisticsStoDetailSql');
  const { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } = dist('utils/truckingWbActualSumSql');
  try {
    const ops = await pool.query(
      `SELECT t.id, t.operation_id, t.status, t.quantity_delivered AS op_quantity_delivered,
              c.id AS contract_uuid, c.contract_id, c.po_number, c.incoterm, c.quantity_ordered,
              ${sqlWbActualDeliverySumKg('t.id')} AS wb_delivery_kg,
              ${sqlWbActualReceiveSumKg('t.id')} AS wb_receive_kg
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       WHERE ($1::text IS NOT NULL AND TRIM(t.operation_id::text) = $1)
          OR ($2::text IS NOT NULL AND (c.contract_id = $2 OR TRIM(c.po_number::text) = $2))
       ORDER BY t.created_at DESC
       LIMIT 5`,
      [operation, contract],
    );
    if (ops.rows.length === 0) {
      console.log('No trucking operation found for that Operation ID / contract.');
      return;
    }
    for (const op of ops.rows) {
      const contractKg = num(op.quantity_ordered);
      const threshold = contractKg != null ? contractKg / 100 : null;
      console.log('='.repeat(100));
      console.log(`Operation ${op.operation_id}  status=${op.status}  contract=${op.contract_id}  incoterm=${op.incoterm}`);
      console.log(`Contract qty      : ${contractKg} kg (${mt(contractKg)})   -> 1% threshold = ${threshold} kg`);
      console.log(`Operation qty     : ${op.op_quantity_delivered} (trucking_operations.quantity_delivered)`);
      console.log(`WB delivery sum   : ${op.wb_delivery_kg} kg (${mt(op.wb_delivery_kg)})    WB receive sum: ${op.wb_receive_kg} kg (${mt(op.wb_receive_kg)})`);

      const daily = await pool.query(
        `SELECT * FROM trucking_daily_actuals WHERE trucking_operation_id = $1 ORDER BY progress_date LIMIT 30`,
        [op.id],
      );
      console.log(`\nWB daily actuals (${daily.rows.length} row(s), first 30):`);
      for (const r of daily.rows) {
        const date = r.actual_date || r.progress_date || r.date || '';
        console.log(`  ${String(date).slice(0, 10)}  delivery_kg=${r.quantity_delivery_kg}  quantity_kg=${r.quantity_kg}  receive_kg=${r.quantity_receive_kg}`);
      }

      const sap = await pool.query(
        `SELECT spd.created_at, spd.sto_number,
                ${sqlSapQtyDeliveredAnyFromSpd('spd', 'c.incoterm')} AS raw_delivered
         FROM sap_processed_data spd
         INNER JOIN contracts c ON c.id = $1::uuid
         WHERE spd.contract_number = c.contract_id
            OR (NULLIF(TRIM(c.po_number::text), '') IS NOT NULL AND spd.po_number::text = TRIM(c.po_number::text))
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 20`,
        [op.contract_uuid],
      );
      console.log(`\nSAP rows (${sap.rows.length}, newest first): raw delivered value -> what KLIP makes of it`);
      for (const r of sap.rows) {
        const raw = num(r.raw_delivered);
        const scaled = raw != null && raw > 0 && threshold != null && raw <= threshold;
        console.log(
          `  ${new Date(r.created_at).toISOString().slice(0, 16)}  sto=${r.sto_number || '-'}  raw=${r.raw_delivered}` +
            `  -> ${scaled ? `x1000 = ${raw * 1000} kg (${mt(raw * 1000)})  <== treated as MT` : `${raw} kg (${mt(raw)})`}`,
        );
      }

      const wb = num(op.wb_delivery_kg) || 0;
      const sapSum = sap.rows.reduce((s, r) => {
        const raw = num(r.raw_delivered) || 0;
        return s + (raw > 0 && threshold != null && raw <= threshold ? raw * 1000 : raw);
      }, 0);
      console.log('\nVERDICT (indicative - the STO row sums the SAP rows of its STO key, not every row above):');
      if (wb > 0 && wb > sapSum) console.log(`  WB wins: GREATEST(WB ${mt(wb)}, SAP ${mt(sapSum)}). If WB is the 1000x value, the WB import is wrong (B).`);
      else if (sap.rows.some((r) => num(r.raw_delivered) > 0 && num(r.raw_delivered) <= (threshold ?? 0))) console.log('  A raw SAP value is at or below 1% of the contract quantity and is being multiplied by 1000 (A).');
      else console.log('  Neither path explains it from these numbers - send this output.');
    }
  } catch (error) {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
