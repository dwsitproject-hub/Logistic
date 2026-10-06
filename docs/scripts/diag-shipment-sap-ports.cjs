/**
 * Why does Add New Shipment (and any reader of the PO lines) show an empty Loading / Discharge Port for a PO that has them in SAP?
 *
 * The modal's "Discharge Port (from SAP)" and each estimation's "Loading Port (from SAP)" come from PURCHASE_ORDER_LINES_SQL
 * (shipment.controller.ts), which resolves the port with sapLoadingPortTextSubquery / sapDischargePortTextSubquery: the port text of
 * the ONE newest sap_processed_data row for the contract number (no PO filter, deleted lines included), and NULL when that row has no
 * port text or only a numeric SAP port code. So one newest row without a port hides every other row that has one.
 *
 * READ ONLY. For each contract prints what the modal gets, then every sap_processed_data row newest first with its port text, the
 * Delete PO Status flag and whether it is the row the subquery picked. Needs no deploy - it uses the code already in the image.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-shipment-sap-ports.cjs \
 *     | docker exec -i klip-backend node - --contracts=1004031313
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const port = dist('utils/portDisplaySql');
  const fmt = dist('utils/sapMasterV2UatFormat');

  const arg = process.argv.find((a) => a.startsWith('--contracts='));
  const contracts = (arg ? arg.slice('--contracts='.length) : '').split(',').map((s) => s.trim()).filter(Boolean);
  if (contracts.length === 0) {
    console.error('Give the contracts: --contracts=1004031313[,...]');
    process.exit(1);
  }

  for (const cn of contracts) {
    const modal = await pool.query(
      `SELECT c.po_number,
              ${port.resolvedLoadingPortNameSql('c.contract_id')} AS loading,
              ${port.resolvedDischargePortNameSql('c.contract_id')} AS discharge
         FROM contracts c WHERE c.contract_id = $1`,
      [cn],
    );
    console.log(`\n=== contract ${cn} ===`);
    if (modal.rows.length === 0) console.log('  not in contracts');
    for (const m of modal.rows) {
      console.log(`  modal gets (PO ${m.po_number}): loading=${m.loading ?? 'NULL'}  discharge=${m.discharge ?? 'NULL'}`);
    }

    const rows = await pool.query(
      `SELECT spd.id::text AS id, spd.po_number, spd.sto_number, spd.created_at,
              ${port.sapSpdLoadingPortTextExpr('spd')} AS lp_text,
              ${port.sapSpdDischargePortTextExpr('spd')} AS dp_text,
              ${fmt.sqlSpdHasDeletePoFlagFromRow('spd')} AS deleted_po_line,
              ROW_NUMBER() OVER (ORDER BY spd.created_at DESC NULLS LAST) AS rn
         FROM sap_processed_data spd
        WHERE spd.contract_number = $1
        ORDER BY spd.created_at DESC NULLS LAST`,
      [cn],
    );
    console.log(`  ${rows.rows.length} sap_processed_data row(s), newest first (rn 1 = the row the modal reads):`);
    for (const r of rows.rows.slice(0, 25)) {
      const mark = Number(r.rn) === 1 ? ' <== picked' : '';
      console.log(
        `    rn=${r.rn} po=${r.po_number || '-'} sto=${r.sto_number || '-'} created=${r.created_at ? new Date(r.created_at).toISOString() : '-'} ` +
          `LP=${r.lp_text ?? 'NULL'} DP=${r.dp_text ?? 'NULL'} deletedPoLine=${r.deleted_po_line ? 'YES' : 'no'}${mark}`,
      );
    }
    if (rows.rows.length > 25) console.log(`    ... ${rows.rows.length - 25} older row(s) not shown`);

    const withPort = rows.rows.filter((r) => r.lp_text || r.dp_text).length;
    const picked = rows.rows[0];
    if (picked && !picked.lp_text && !picked.dp_text && withPort > 0) {
      console.log(`  -> the newest row has no port text while ${withPort} other row(s) do: that is why the modal shows it empty.`);
    }
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
