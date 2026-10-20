/*
 * READ-ONLY: contracts that read Cancelled only because an OLD row of the PO carries Delete PO Status while NEWER lines of the same PO are live.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-stale-delete-po-flag.cjs | docker exec -i klip-backend node -
 *
 * The read side (contractDeliveryStatus `deletePoExists`) looks for a Delete PO Status row of the PO in ANY import. Production 2026-10-20, KARAWANG: B2B child 1014003154
 * (PO 1011003154) holds a header row without an STO from import 94077684 (30 Sep) with Delete PO Status "S"; its STO lines from import fb26f662 (19 Oct) are live (GR PO Open,
 * GR STO Close, no flag). Every STO of that PO therefore reads Cancelled, the STO group 1016011366 reads Cancelled instead of Close, and Shipping Performance keeps 112.1 MT of
 * 1014003192 open while Contract Performance and Shipments do not. Ryan's rule (2026-10-06) is the other way: a PO is Cancelled only when every line is deleted.
 *
 * This lists every PO whose newest flagged row is OLDER than a live line (no Delete PO, no Delete STO, a real STO) of the same PO, with what the contract reads today and what
 * Contract Performance holds for it. It does not say the flag is wrong for every one of them - a PO deleted in SAP after its lines were last exported looks the same - which is
 * why the date comparison is printed and not hidden. Writes nothing.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { sqlSpdHasDeletePoFlagFromRow, sqlSpdHasDeleteStoFlagFromRow } = dist('utils/sapMasterV2UatFormat');
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

  const r = await pool.query(
    `SELECT c.contract_id, c.po_number, c.status AS contract_status, ${sqlContractImportStatusExpr('c')} AS import_status,
            f.flag_seen, f.flagged_rows, l.live_seen, l.live_rows,
            snap.plant_site, snap.incoterm, snap.status AS cp_status, snap.outstanding_quantity
       FROM contracts c
       JOIN LATERAL (
         SELECT MAX(d.last_seen_at) AS flag_seen, COUNT(*)::int AS flagged_rows
           FROM sap_processed_data d
          WHERE d.po_number = c.po_number AND (d.contract_number = c.contract_id OR d.contract_number IS NULL OR TRIM(d.contract_number) = '')
            AND ${sqlSpdHasDeletePoFlagFromRow('d')}
       ) f ON f.flag_seen IS NOT NULL
       JOIN LATERAL (
         SELECT MAX(o.last_seen_at) AS live_seen, COUNT(*)::int AS live_rows
           FROM sap_processed_data o
          WHERE o.po_number = c.po_number AND (o.contract_number = c.contract_id OR o.contract_number IS NULL OR TRIM(o.contract_number) = '')
            AND NULLIF(TRIM(o.sto_number::text), '') IS NOT NULL
            AND NOT (${sqlSpdHasDeletePoFlagFromRow('o')}) AND NOT (${sqlSpdHasDeleteStoFlagFromRow('o')})
       ) l ON l.live_seen > f.flag_seen
       LEFT JOIN contract_performance_snapshot snap ON snap.contract_id = c.contract_id
      ORDER BY snap.plant_site NULLS LAST, c.contract_id`,
  );
  console.log(`POs whose newest Delete PO row is older than a live STO line: ${r.rows.length}`);
  const cancelled = r.rows.filter((x) => String(x.import_status || '').toUpperCase() === 'CANCELLED');
  console.log(`   of them reading Cancelled today (the ones that would change): ${cancelled.length}`);
  const open = cancelled.filter((x) => Number(x.outstanding_quantity) > 0);
  console.log(`   ... with outstanding quantity in the Contract Performance snapshot: ${open.length}   ${mt(open.reduce((a, x) => a + Number(x.outstanding_quantity), 0))} MT`);
  const bySite = new Map();
  for (const x of open) {
    const k = `${x.plant_site || '-'} / ${x.incoterm || '-'}`;
    const cur = bySite.get(k) || { n: 0, kg: 0 };
    cur.n += 1;
    cur.kg += Number(x.outstanding_quantity);
    bySite.set(k, cur);
  }
  for (const [k, v] of [...bySite.entries()].sort((a, b) => b[1].kg - a[1].kg)) console.log('      ' + k.padEnd(28) + String(v.n).padStart(4) + ' contracts   ' + (mt(v.kg) + ' MT').padStart(12));

  console.log('\ncontract      PO            site          inco read today   contract st  cp st      flag seen   live seen   OS');
  for (const x of r.rows.slice(0, 80)) {
    console.log(
      String(x.contract_id).padEnd(14) + String(x.po_number).padEnd(14) + String(x.plant_site || '-').padEnd(14) + String(x.incoterm || '-').padEnd(5) +
        String(x.import_status || '-').padEnd(11) + String(x.contract_status || '-').padEnd(13) + String(x.cp_status || '-').padEnd(11) +
        day(x.flag_seen).padEnd(12) + day(x.live_seen).padEnd(12) + (mt(x.outstanding_quantity) + ' MT').padStart(10),
    );
  }
  if (r.rows.length > 80) console.log(`   ... ${r.rows.length - 80} more`);
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
