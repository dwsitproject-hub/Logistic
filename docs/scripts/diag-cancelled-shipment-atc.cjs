/*
 * READ-ONLY: contracts whose last ATC comes from a CANCELLED shipment - and so read as "finished" on Contract Performance.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cancelled-shipment-atc.cjs | docker exec -i klip-backend node -
 *
 * sqlLastAtaVesselCompleteDischargeForContract takes the MAX ATC over EVERY shipment of the contract, cancelled ones included. Contract 1004032300 (PO
 * 1001032300, production 2026-10-20) has seven shipments: six PLANNED with no ATC, and one CANCELLED (STO 1006020263, deleted by SAP) carrying a KLIP override
 * ATC 2026-10-07. Contract Performance read that as "the contract has discharged" (all_stos_discharged = true, last ATC 2026-10-07) and dropped its 700 MT from
 * Open, while Shipping Performance and Shipments - which do not count a cancelled shipment - kept it.
 *
 * This lists every contract where the last ATC changes once cancelled shipments are set aside, with what Contract Performance holds for it today. It decides
 * nothing by itself: whether such a contract would become Open also depends on the other "effectively done" rules. Writes nothing.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { sqlJpsAtaWhileOpen } = dist('utils/shipmentAtaOverrideSql');
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

  const r = await pool.query(
    `WITH atc AS (
       SELECT s.contract_id, UPPER(COALESCE(s.status, '')) AS st,
              COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao', 's')}::date, sao.ata_discharge_complete::date, s.ata_discharge_complete::date, vlp.ata_loading_completed::date) AS atc
         FROM shipments s
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
         LEFT JOIN LATERAL (
           SELECT v.ata_loading_completed FROM vessel_loading_ports v
            WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, FALSE) = TRUE AND v.ata_loading_completed IS NOT NULL
            ORDER BY v.ata_loading_completed DESC LIMIT 1
         ) vlp ON TRUE
     ), per_contract AS (
       SELECT contract_id, MAX(atc) AS last_atc_all, MAX(atc) FILTER (WHERE st NOT IN ('CANCELLED', 'CANCELED')) AS last_atc_live,
              COUNT(*) FILTER (WHERE st NOT IN ('CANCELLED', 'CANCELED'))::int AS live_shipments
         FROM atc GROUP BY contract_id
       HAVING MAX(atc) IS DISTINCT FROM MAX(atc) FILTER (WHERE st NOT IN ('CANCELLED', 'CANCELED'))
     )
     SELECT c.contract_id, c.po_number, c.status, ${sqlContractImportStatusExpr('c')} AS import_status,
            p.last_atc_all, p.last_atc_live, p.live_shipments,
            snap.incoterm, snap.plant_site, snap.outstanding_quantity, snap.status AS cp_status
       FROM per_contract p
       JOIN contracts c ON c.id = p.contract_id
       LEFT JOIN contract_performance_snapshot snap ON snap.contract_id = c.contract_id
      ORDER BY snap.plant_site NULLS LAST, c.contract_id`,
  );
  console.log(`contracts whose last ATC changes when cancelled shipments are set aside: ${r.rows.length}`);

  const open = r.rows.filter((x) => String(x.import_status || '').toUpperCase() !== 'CLOSE' && Number(x.outstanding_quantity) > 0 && String(x.cp_status || x.status).toUpperCase() !== 'CANCELLED');
  console.log(`   of them still open in SAP with outstanding quantity (the ones that could return to Open): ${open.length}   ${mt(open.reduce((a, x) => a + Number(x.outstanding_quantity), 0))} MT`);
  const bySite = new Map();
  for (const x of open) {
    const k = `${x.plant_site || '-'} / ${x.incoterm || '-'}`;
    const cur = bySite.get(k) || { n: 0, kg: 0 };
    cur.n += 1;
    cur.kg += Number(x.outstanding_quantity);
    bySite.set(k, cur);
  }
  for (const [k, v] of [...bySite.entries()].sort((a, b) => b[1].kg - a[1].kg)) console.log('      ' + k.padEnd(28) + String(v.n).padStart(4) + ' contracts   ' + (mt(v.kg) + ' MT').padStart(12));

  console.log('\nevery contract:');
  for (const x of r.rows) {
    console.log(
      '   ' + String(x.contract_id).padEnd(12) + String(x.plant_site || '-').padEnd(14) + String(x.incoterm || '-').padEnd(5) + ('import ' + (x.import_status || '-')).padEnd(15) +
        ('cp ' + (x.cp_status || x.status || '-')).padEnd(16) + ('OS ' + mt(x.outstanding_quantity) + ' MT').padEnd(17) +
        'ATC ' + String(x.last_atc_all).slice(0, 10) + ' -> ' + (x.last_atc_live ? String(x.last_atc_live).slice(0, 10) : 'none') + '   live shipments ' + x.live_shipments,
    );
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
