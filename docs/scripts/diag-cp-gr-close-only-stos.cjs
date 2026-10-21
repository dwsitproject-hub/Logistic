/*
 * READ-ONLY: vessel STOs that are finished only because their GR is Close - and the contracts Contract Performance still holds Open because of them.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-gr-close-only-stos.cjs | docker exec -i klip-backend node -
 *
 * Contract Performance finishes a PO when every vessel STO has a finished shipment. A shipment used to count only with an ATC, or with stored status COMPLETED AND a Close GR;
 * a shipment whose GR is Close but whose stored status is still SAILED (the status moves only when SAP re-imports the row) did not. Shipping Performance and Shipments make a
 * Close GR COMPLETED on their own, so they disagreed: BATAM 2026-10-21, 1004032751, STO 1006020594 (500 MT, GR Close, stored SAILED, no ATC) - CP 19,897.9 MT, SP 19,400.1,
 * Shipments 19,400. The rule now counts a Close GR on its own (contractsListCycleSql: sqlContractVesselStosFinishedExpr).
 *
 * This lists every non-cancelled shipment on a vessel STO whose GR is Close, with no ATC and a stored status other than COMPLETED - the shipments only the new reading finishes -
 * with the contract's Contract Performance row (Open? outstanding) and the verdict of the rule in the build that runs this. A contract flips only when ALL its vessel STOs are
 * finished, so a listed contract with verdict "false" and other STOs unfinished stays Open. Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

(async () => {
  const pool = load('database/connection').default;
  const { sqlIsContractSapClosedForStoExpr } = load('utils/contractDeliveryStatus');
  const { sqlContractVesselStosFinishedExpr } = load('utils/contractsListCycleSql');
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

  const r = await pool.query(
    `WITH vessel_sto AS (
       SELECT DISTINCT cvk.contract_id AS contract_number, cvk.id AS contract_uuid, TRIM(cvs.sto_number::text) AS sto
         FROM contract_stos cvs
         JOIN contracts cvk ON cvk.id = cvs.contract_id
        WHERE NULLIF(TRIM(cvs.sto_number::text), '') IS NOT NULL
          AND UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'
     )
     SELECT v.contract_number, v.sto, s.operation_id, s.status AS shipment_status, c.incoterm, snap.plant_site, snap.outstanding_quantity, snap.status AS cp_status,
            (${sqlContractVesselStosFinishedExpr('v.contract_number')}) AS finished_verdict
       FROM vessel_sto v
       JOIN contracts c ON c.id = v.contract_uuid
       JOIN shipments s ON s.contract_id = v.contract_uuid
            AND UPPER(TRIM(COALESCE(s.status, ''))) <> 'CANCELLED'
            AND (TRIM(COALESCE(s.shipment_id::text, '')) = v.sto OR TRIM(COALESCE(s.shipment_id::text, '')) LIKE v.sto || '-%')
       LEFT JOIN contract_performance_snapshot snap ON snap.contract_id = v.contract_number
      WHERE UPPER(TRIM(COALESCE(s.status, ''))) <> 'COMPLETED'
        AND s.ata_discharge_complete IS NULL
        AND NOT EXISTS (SELECT 1 FROM shipment_ata_overrides o WHERE o.shipment_id = s.id AND o.ata_discharge_complete IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM vessel_loading_ports p WHERE p.shipment_id = s.id AND COALESCE(p.is_discharge_port, FALSE) = TRUE AND p.ata_loading_completed IS NOT NULL)
        AND (${sqlIsContractSapClosedForStoExpr('c', 'v.sto')})
      ORDER BY snap.plant_site NULLS LAST, v.contract_number, v.sto`,
  );
  console.log(`shipments finished ONLY by a Close GR (no ATC, stored status not COMPLETED): ${r.rows.length}`);
  const contracts = new Map();
  for (const x of r.rows) {
    const c = contracts.get(x.contract_number) || { ...x, stos: [] };
    c.stos.push(x.sto + ' (' + x.shipment_status + ')');
    contracts.set(x.contract_number, c);
  }
  const list = [...contracts.values()];
  const open = list.filter((c) => Number(c.outstanding_quantity) > 0 && String(c.cp_status || '').toUpperCase() !== 'CANCELLED');
  console.log(`contracts: ${list.length}   of them with outstanding quantity on Contract Performance: ${open.length}   ${mt(open.reduce((a, c) => a + Number(c.outstanding_quantity), 0))} MT`);
  console.log('   (the rule in THIS build says finished = ' + (list.length ? 'see the column below' : '-') + '; on the build before the change it is false for the ones CP holds Open because of this STO)\n');
  console.log('contract      site          inco  OS (MT)      verdict  STOs finished only by a Close GR');
  for (const c of list.sort((a, b) => Number(b.outstanding_quantity || 0) - Number(a.outstanding_quantity || 0)).slice(0, 60)) {
    console.log(
      String(c.contract_number).padEnd(14) + String(c.plant_site || '-').padEnd(14) + String(c.incoterm || '-').padEnd(6) + (mt(c.outstanding_quantity)).padStart(9) + '   ' +
        String(c.finished_verdict).padEnd(9) + c.stos.join(', ').slice(0, 70),
    );
  }
  if (list.length > 60) console.log(`   ... ${list.length - 60} more`);
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
