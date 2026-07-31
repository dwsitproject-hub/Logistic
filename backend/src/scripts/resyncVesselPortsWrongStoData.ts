/**
 * One-off re-sync for shipments whose vessel loading ports were filled from the WRONG STO.
 *
 * Background: resolveLatestSapParsedDataForShipment matched either the shipment's own STO or, as a
 * fallback, any SAP row of the same contract - then ordered by created_at DESC. A contract can
 * carry many STOs, so a newer SIBLING STO's row outranked the shipment's own and supplied its
 * vessel and quality values. STO 1016010973 showed FFA 0.00 while SAP reported 4.841, because
 * sibling 1016010976 was imported a day later.
 *
 * The resolver now ranks an exact STO match first, and the sync fills gaps only. Affected rows
 * self-heal whenever someone opens the shipment; this script does the whole set at once instead of
 * waiting for a visit.
 *
 * Safe by construction: it calls the same fill-gaps sync the app uses, so a value a user typed is
 * never overwritten - only empty fields (and quality readings stored as 0) are filled.
 *
 * Preview:  npx ts-node src/scripts/resyncVesselPortsWrongStoData.ts
 * Execute:  npx ts-node src/scripts/resyncVesselPortsWrongStoData.ts --confirm
 */

import { query } from '../database/connection';
import { syncVesselLoadingPortsFromLatestSap } from '../services/vesselLoadingPortsFromSap.service';

const CONFIRM = process.argv.includes('--confirm');

/**
 * Shipments whose contract has a sibling STO imported AFTER their own STO's row - exactly the
 * condition under which the old resolver picked the sibling.
 */
const SQL_AFFECTED = `
  WITH ship AS (
    SELECT s.id, s.shipment_id, NULLIF(TRIM(c.sto_number::text), '') AS sto, c.contract_id
    FROM shipments s
    JOIN contracts c ON c.id = s.contract_id
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
  ),
  own AS (
    SELECT sh.id, sh.shipment_id, sh.sto, sh.contract_id, spd.created_at AS own_created
    FROM ship sh
    JOIN sap_processed_data spd
      ON TRIM(spd.sto_number) = sh.sto
     AND spd.contract_number = sh.contract_id
  ),
  sibling AS (
    SELECT o.id, MAX(spd.created_at) AS newest_sibling
    FROM own o
    JOIN sap_processed_data spd
      ON spd.contract_number = o.contract_id
     AND TRIM(COALESCE(spd.sto_number, '')) <> o.sto
    GROUP BY o.id
  )
  SELECT o.id::text AS shipment_uuid, o.shipment_id, o.sto, o.contract_id
  FROM own o
  JOIN sibling s ON s.id = o.id
  WHERE s.newest_sibling > o.own_created
  ORDER BY o.sto
`;

/** Quality columns are the visible symptom: SAP's absent-reading 0.000 got stored as 0. */
const SQL_QUALITY_SNAPSHOT = `
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(quality_ffa, 0) = 0) AS ffa_zero,
    COUNT(*) FILTER (WHERE COALESCE(quality_mi, 0) = 0) AS mi_zero,
    COUNT(*) AS port_rows
  FROM vessel_loading_ports
  WHERE shipment_id = $1::uuid
    AND COALESCE(is_cancelled, false) = false
    AND COALESCE(is_discharge_port, false) = false
`;

async function qualitySnapshot(shipmentUuid: string) {
  const res = await query(SQL_QUALITY_SNAPSHOT, [shipmentUuid]);
  const row = res.rows[0] ?? {};
  return {
    ffaZero: Number(row.ffa_zero ?? 0),
    miZero: Number(row.mi_zero ?? 0),
    portRows: Number(row.port_rows ?? 0),
  };
}

async function main() {
  const affected = await query(SQL_AFFECTED);
  const rows = affected.rows as Array<{
    shipment_uuid: string;
    shipment_id: string;
    sto: string;
    contract_id: string;
  }>;

  console.log(`Shipments that were fed a sibling STO's data: ${rows.length}`);
  if (rows.length === 0) return;

  if (!CONFIRM) {
    console.log('\nDRY RUN - nothing written. Re-run with --confirm to apply.\n');
    for (const r of rows.slice(0, 20)) {
      const before = await qualitySnapshot(r.shipment_uuid);
      console.log(
        `  STO ${r.sto} (contract ${r.contract_id}) - ${before.portRows} loading port row(s), ` +
          `${before.ffaZero} with FFA 0, ${before.miZero} with M&I 0`,
      );
    }
    if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
    return;
  }

  let synced = 0;
  let unchanged = 0;
  let failed = 0;
  let ffaRepaired = 0;
  let miRepaired = 0;

  // Sequential on purpose. A previous parallel vessel backfill exhausted the connection pool and
  // took the API down with HTTP 500s; 93 shipments do not need concurrency.
  for (const r of rows) {
    const before = await qualitySnapshot(r.shipment_uuid);
    try {
      const didWrite = await syncVesselLoadingPortsFromLatestSap(r.shipment_uuid);
      const after = await qualitySnapshot(r.shipment_uuid);
      const ffaFixed = Math.max(0, before.ffaZero - after.ffaZero);
      const miFixed = Math.max(0, before.miZero - after.miZero);
      ffaRepaired += ffaFixed;
      miRepaired += miFixed;
      if (didWrite) synced += 1;
      else unchanged += 1;
      if (ffaFixed > 0 || miFixed > 0) {
        console.log(`  STO ${r.sto}: filled FFA on ${ffaFixed} row(s), M&I on ${miFixed} row(s)`);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `  STO ${r.sto} (shipment ${r.shipment_id}) FAILED:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(
    `\nDone. considered=${rows.length} written=${synced} already-correct=${unchanged} failed=${failed}` +
      `\nQuality readings filled: FFA on ${ffaRepaired} port row(s), M&I on ${miRepaired} port row(s)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
