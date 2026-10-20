/*
 * READ-ONLY: shipments still ACTIVE on an STO that SAP has deleted.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-active-shipments-of-deleted-sto.cjs | docker exec -i klip-backend node -
 *
 * A SAP line with Delete STO Status cancels the shipments of THAT STO (sapDataDistribution cancelShipmentsOfDeletedSto, and the shipment upsert itself). It does so only
 * when the row is distributed, and a row that has not changed is hash-skipped on re-import, so a shipment of an STO deleted before the rule - or deleted in a file whose
 * row did not change afterwards - stays active. Production 2026-10-20, KARAWANG: B2B child 1014003154 holds STO 1016011366 as Cancelled (deleted) with its shipment still
 * SAILED; Shipping Performance aggregates the group's import_status over its members, reads "Cancelled" and keeps the group row open (112.1 MT of 1014003192), while Shipments
 * reads the origins and finishes it. Contract Performance agrees with Shipments.
 *
 * This lists every active shipment whose own STO carries Delete STO Status in the stored SAP lines and has no live line of the same STO. Whether such a shipment should be
 * cancelled is Ryan's call (a SAILED one may really have moved cargo); this only counts them. Writes nothing.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { sqlSpdHasDeletePoFlagFromRow, sqlSpdHasDeleteStoFlagFromRow } = dist('utils/sapMasterV2UatFormat');
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');

  const r = await pool.query(
    `SELECT c.contract_id, c.po_number, c.status AS contract_status, c.incoterm,
            s.shipment_id, s.operation_id, s.status AS shipment_status, s.vessel_name,
            snap.plant_site, snap.outstanding_quantity
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_performance_snapshot snap ON snap.contract_id = c.contract_id
      WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
        AND NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
        AND EXISTS (
          SELECT 1 FROM sap_processed_data d
           WHERE d.po_number = c.po_number AND TRIM(d.sto_number::text) = TRIM(s.shipment_id::text)
             AND ${sqlSpdHasDeleteStoFlagFromRow('d')}
        )
        AND NOT EXISTS (
          SELECT 1 FROM sap_processed_data o
           WHERE o.po_number = c.po_number AND TRIM(o.sto_number::text) = TRIM(s.shipment_id::text)
             AND NOT (${sqlSpdHasDeleteStoFlagFromRow('o')}) AND NOT (${sqlSpdHasDeletePoFlagFromRow('o')})
        )
      ORDER BY snap.plant_site NULLS LAST, c.contract_id, s.shipment_id`,
  );
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
  console.log(`active shipments on an STO that SAP has deleted: ${r.rows.length}`);
  const byStatus = new Map();
  for (const x of r.rows) byStatus.set(x.shipment_status, (byStatus.get(x.shipment_status) || 0) + 1);
  console.log('   by shipment status: ' + ([...byStatus.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || '-'));
  const bySite = new Map();
  for (const x of r.rows) bySite.set(x.plant_site || '-', (bySite.get(x.plant_site || '-') || 0) + 1);
  console.log('   by site: ' + ([...bySite.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || '-'));
  console.log('\ncontract      site          inco shipment st   STO            vessel                    contract OS');
  for (const x of r.rows.slice(0, 80)) {
    console.log(
      String(x.contract_id).padEnd(14) + String(x.plant_site || '-').padEnd(14) + String(x.incoterm || '-').padEnd(5) + String(x.shipment_status).padEnd(12) +
        String(x.shipment_id).padEnd(15) + String(x.vessel_name || '-').slice(0, 24).padEnd(26) + (mt(x.outstanding_quantity) + ' MT').padStart(11),
    );
  }
  if (r.rows.length > 80) console.log(`   ... ${r.rows.length - 80} more`);
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
