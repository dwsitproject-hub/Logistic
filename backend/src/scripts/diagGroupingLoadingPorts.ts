/**
 * Read-only. Do the POs that Upload Planning can group have an SAP Vessel Loading Port?
 *
 * Uses the same two lookups the upload itself uses - prefetchManualGroupingEligibleIdentities() (which POs are eligible)
 * and fetchSapPortsForContractUuids() (their SAP loading / discharge port) - so the answer is what an upload would see.
 * Also counts eligible POs whose SAP rows name a second or third loading port, which the upload cannot represent
 * (it keeps one port per PO).
 *
 *   node dist/scripts/diagGroupingLoadingPorts.js
 *   node dist/scripts/diagGroupingLoadingPorts.js --list      (also print the POs without a loading port)
 */
import pool, { query } from '../database/connection';
import { prefetchManualGroupingEligibleIdentities } from '../utils/shipmentPreplannedGroupingTemplateSql';
import { fetchSapPortsForContractUuids } from '../utils/shipmentGroupingPlannedResolve';

type Bucket = { eligible: number; withLoading: number; withoutLoading: number; withoutDischarge: number; multiPort: number };

async function main(): Promise<void> {
  const list = process.argv.includes('--list');
  const eligible = await prefetchManualGroupingEligibleIdentities();
  const ports = await fetchSapPortsForContractUuids(eligible.map((e) => e.id));

  // Contracts whose SAP rows carry more than one loading port: a Vessel Loading Port 2 / 3, or two different port 1 values.
  const multi = await query(
    `SELECT DISTINCT spd.contract_number
       FROM sap_processed_data spd
      WHERE spd.contract_number = ANY($1::text[])
      GROUP BY spd.contract_number
     HAVING BOOL_OR(NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Vessel Loading Port 2', spd.data->'shipment'->>'vessel_loading_port_2')), '') IS NOT NULL)
         OR BOOL_OR(NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Vessel Loading Port 3', spd.data->'shipment'->>'vessel_loading_port_3')), '') IS NOT NULL)
         OR COUNT(DISTINCT NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Vessel Loading Port', spd.data->'raw'->>'Vessel Loading Port 1', spd.data->'shipment'->>'vessel_loading_port')), '')) > 1`,
    [eligible.map((e) => e.contractNumber).filter(Boolean)],
  );
  const multiContracts = new Set((multi.rows as Array<{ contract_number: string }>).map((r) => r.contract_number));

  const byIncoterm = new Map<string, Bucket>();
  const missing: string[] = [];
  for (const e of eligible) {
    const inc = String(e.incoterm || '(none)').trim().toUpperCase() || '(none)';
    const b = byIncoterm.get(inc) ?? { eligible: 0, withLoading: 0, withoutLoading: 0, withoutDischarge: 0, multiPort: 0 };
    const p = ports.get(e.id);
    b.eligible += 1;
    if (p?.loadingPort) b.withLoading += 1;
    else {
      b.withoutLoading += 1;
      missing.push(`${inc}\t${e.poNumber}\t${e.contractNumber}`);
    }
    if (!p?.dischargePort) b.withoutDischarge += 1;
    if (multiContracts.has(e.contractNumber)) b.multiPort += 1;
    byIncoterm.set(inc, b);
  }

  console.log(`Eligible POs (what Upload Planning can group): ${eligible.length}`);
  console.table(Object.fromEntries([...byIncoterm.entries()].sort()));
  if (list && missing.length > 0) {
    console.log('\nincoterm\tPO\tcontract  (no SAP Vessel Loading Port)');
    console.log(missing.slice(0, 200).join('\n'));
    if (missing.length > 200) console.log(`... ${missing.length - 200} more`);
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
