/*
 * READ-ONLY: which contracts does Contract Performance hold Open only because a vessel STO is finished by a Close GR alone - and which of them would leave Open?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-gr-close-only-stos.cjs | docker exec -i klip-backend node -
 *
 * Contract Performance finishes a PO when every vessel STO has a finished shipment. A shipment used to count only with an ATC, or with stored status COMPLETED AND a Close GR;
 * a shipment whose GR is Close but whose stored status is still SAILED (the status moves only when SAP re-imports the row) did not. Shipping Performance and Shipments make a
 * Close GR COMPLETED on their own, so they disagreed: BATAM 2026-10-21, 1004032751, STO 1006020594 (500 MT, GR Close, stored SAILED, no ATC) - CP 19,897.9 MT, SP 19,400.1,
 * Shipments 19,400. The rule now counts a Close GR on its own (contractsListCycleSql: sqlContractVesselStosFinishedExpr).
 *
 * For every non-cancelled shipment on a vessel STO whose GR is Close, with no ATC and a stored status other than COMPLETED - the shipments only the new reading finishes - this prints
 * the contract's verdict under BOTH readings of the rule, computed here whichever build runs this (the stored-COMPLETED test is swapped for TRUE in the rule's own SQL), and its
 * Contract Performance row as the page reads it (Open? outstanding). A contract LEAVES Open only when its verdict goes false -> true, i.e. ALL its vessel STOs are finished. Writes nothing.
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
  const { parseLatePerformanceFilters, loadLatePerformanceRows, rowMatchesContractPerfStatusFilter } = load('services/latePerformance.service');
  const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

  // The rule's SQL as the build running this writes it. The earlier reading tests "stored status COMPLETED AND GR Close"; the new one drops the stored-status test. Swapping that one
  // test for TRUE makes either build compute the NEW reading, so the measurement does not depend on which build is deployed.
  const ruleSql = sqlContractVesselStosFinishedExpr('v.contract_number');
  const newRuleSql = ruleSql.split("UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED'").join('TRUE');

  const r = await pool.query(
    `WITH vessel_sto AS (
       SELECT DISTINCT cvk.contract_id AS contract_number, cvk.id AS contract_uuid, TRIM(cvs.sto_number::text) AS sto
         FROM contract_stos cvs
         JOIN contracts cvk ON cvk.id = cvs.contract_id
        WHERE NULLIF(TRIM(cvs.sto_number::text), '') IS NOT NULL
          AND UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'
     )
     SELECT v.contract_number, v.sto, s.operation_id, s.status AS shipment_status, c.incoterm,
            (${ruleSql}) AS verdict_build, (${newRuleSql}) AS verdict_new
       FROM vessel_sto v
       JOIN contracts c ON c.id = v.contract_uuid
       JOIN shipments s ON s.contract_id = v.contract_uuid
            AND UPPER(TRIM(COALESCE(s.status, ''))) <> 'CANCELLED'
            AND (TRIM(COALESCE(s.shipment_id::text, '')) = v.sto OR TRIM(COALESCE(s.shipment_id::text, '')) LIKE v.sto || '-%')
      WHERE UPPER(TRIM(COALESCE(s.status, ''))) <> 'COMPLETED'
        AND s.ata_discharge_complete IS NULL
        AND NOT EXISTS (SELECT 1 FROM shipment_ata_overrides o WHERE o.shipment_id = s.id AND o.ata_discharge_complete IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM vessel_loading_ports p WHERE p.shipment_id = s.id AND COALESCE(p.is_discharge_port, FALSE) = TRUE AND p.ata_loading_completed IS NOT NULL)
        AND (${sqlIsContractSapClosedForStoExpr('c', 'v.sto')})
      ORDER BY v.contract_number, v.sto`,
  );

  const year = new Date().getFullYear();
  const cpRows = await loadLatePerformanceRows(parseLatePerformanceFilters({ query: { dateFrom: `${year}-01-01`, dateTo: new Date().toISOString().slice(0, 10) } }, 'rows'));
  const cpBy = new Map(cpRows.map((x) => [String(x.contract_id), x]));

  const contracts = new Map();
  for (const x of r.rows) {
    const c = contracts.get(x.contract_number) || { ...x, stos: [] };
    c.stos.push(x.sto + ' (' + x.shipment_status + ')');
    contracts.set(x.contract_number, c);
  }
  const list = [...contracts.values()].map((c) => {
    const cp = cpBy.get(String(c.contract_number));
    return { ...c, cpOpen: cp ? rowMatchesContractPerfStatusFilter(cp, 'Open') : false, cpOs: cp ? Number(cp.outstanding_quantity) : 0, site: cp ? cp.plant_site : '-' };
  });
  const flips = list.filter((c) => c.verdict_build !== true && c.verdict_new === true && c.cpOpen);

  console.log(`shipments finished ONLY by a Close GR (no ATC, stored status not COMPLETED): ${r.rows.length}   on ${list.length} contract(s)`);
  console.log(`of them Open on Contract Performance now: ${list.filter((c) => c.cpOpen).length}   ${mt(list.filter((c) => c.cpOpen).reduce((a, c) => a + c.cpOs, 0))} MT`);
  console.log(`WOULD LEAVE Open (every vessel STO finished under the new reading): ${flips.length}   ${mt(flips.reduce((a, c) => a + c.cpOs, 0))} MT\n`);
  console.log('contract      site          CP Open  OS (MT)   build/new verdict   STOs finished only by a Close GR');
  for (const c of list.sort((a, b) => b.cpOs - a.cpOs).slice(0, 60)) {
    const flip = c.verdict_build !== true && c.verdict_new === true && c.cpOpen ? '  <- LEAVES Open' : '';
    console.log(
      String(c.contract_number).padEnd(14) + String(c.site || '-').padEnd(14) + String(c.cpOpen).padEnd(9) + mt(c.cpOs).padStart(8) + '   ' +
        `${c.verdict_build} -> ${c.verdict_new}`.padEnd(20) + c.stos.join(', ').slice(0, 60) + flip,
    );
  }
  if (list.length > 60) console.log(`   ... ${list.length - 60} more`);
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
