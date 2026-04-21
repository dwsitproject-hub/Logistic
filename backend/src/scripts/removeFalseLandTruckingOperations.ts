/**
 * Deletes LAND trucking_operations whose contract's latest sap_processed_data row
 * does NOT satisfy isLandSapRowEligibleForTruckingCreation (false "land" trucking).
 *
 * By default deletes ALL trucking rows for those contracts (including rows with
 * shipment_id set), because linked rows can remain after SAP/migration churn.
 * Use --only-without-shipment to delete only rows where shipment_id IS NULL (legacy behavior).
 *
 * Run: cd backend && npx ts-node src/scripts/removeFalseLandTruckingOperations.ts
 * Dry-run: ... --dry-run
 * SEA contracts with stray trucking are NOT handled here — use migrateSeaTruckingToShipments
 * or diagnoseLandTruckingCleanup.ts <contract ext no>.
 */

import { getClient } from '../database/connection';
import logger from '../utils/logger';
import {
  isContractLandForTruckingCleanup,
  isLandSapRowEligibleForTruckingCreation,
} from '../utils/landTruckingEligibility';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyWithoutShipment = process.argv.includes('--only-without-shipment');
  const scriptIdx = process.argv.findIndex((a) => String(a).replace(/\\/g, '/').endsWith('/removeFalseLandTruckingOperations.ts'));
  const keyArg =
    scriptIdx >= 0
      ? process.argv.slice(scriptIdx + 1).find((a) => a && !String(a).startsWith('--'))
      : null;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    let onlyContractNumbers: string[] | null = null;
    if (keyArg) {
      const key = String(keyArg).trim();
      // Try resolve as Contract Ext No from latest SAP rows
      const { rows: extRows } = await client.query<{ contract_number: string }>(
        `
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number
        FROM sap_processed_data spd
        WHERE TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) ILIKE $1
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
        LIMIT 50
        `,
        [`%${key}%`]
      );
      const resolved = (extRows || []).map((r) => String(r.contract_number)).filter(Boolean);
      onlyContractNumbers = resolved.length > 0 ? resolved : [key];
      console.log(JSON.stringify({ scope: 'single', key, contract_numbers: onlyContractNumbers }, null, 2));
    }

    const { rows: contractRows } = await client.query<{
      contract_id: string;
      contract_number: string;
      transport_mode: string | null;
    }>(
      `
      SELECT t.contract_id, c.contract_id AS contract_number, c.transport_mode
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE ($1::text[] IS NULL OR c.contract_id = ANY($1::text[]))
      GROUP BY t.contract_id, c.contract_id, c.transport_mode
      `,
      [onlyContractNumbers]
    );

    if (contractRows.length === 0) {
      const { rows: tot } = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM trucking_operations`
      );
      console.log(
        JSON.stringify(
          {
            message: 'No contracts with trucking_operations match the scope.',
            total_trucking_operations_in_db: parseInt(tot[0]?.c || '0', 10),
            hint:
              'If you expected hits: confirm contract_id in DB; SEA contracts are skipped (not LAND). Run: npx ts-node src/scripts/diagnoseLandTruckingCleanup.ts "<Contract Ext No>"',
          },
          null,
          2
        )
      );
      await client.query('COMMIT');
      return;
    }

    const numbers = contractRows.map((r) => r.contract_number).filter(Boolean);
    const { rows: spdRows } = await client.query<{ contract_number: string; data: unknown }>(
      `
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        spd.data
      FROM sap_processed_data spd
      WHERE spd.contract_number = ANY($1::text[])
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      `,
      [numbers]
    );
    const spdByContract = new Map<string, unknown>();
    for (const r of spdRows) {
      spdByContract.set(String(r.contract_number), r.data);
    }

    const contractIdsToPurge: string[] = [];
    let skippedNoSpd = 0;
    let skippedNotLand = 0;
    let skippedEligibleSap = 0;

    for (const row of contractRows) {
      const spd = spdByContract.get(row.contract_number);
      if (spd == null) {
        skippedNoSpd++;
        logger.warn('Skipping contract (no sap_processed_data)', { contract_number: row.contract_number });
        continue;
      }
      if (!isContractLandForTruckingCleanup(row.transport_mode, spd)) {
        skippedNotLand++;
        continue;
      }
      if (isLandSapRowEligibleForTruckingCreation(spd)) {
        skippedEligibleSap++;
        continue;
      }
      contractIdsToPurge.push(row.contract_id);
    }

    const deleteFilterSql = onlyWithoutShipment
      ? `shipment_id IS NULL AND contract_id = ANY($1::uuid[])`
      : `contract_id = ANY($1::uuid[])`;

    let removeCount = 0;
    if (contractIdsToPurge.length > 0) {
      const cnt = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM trucking_operations WHERE ${deleteFilterSql}`,
        [contractIdsToPurge]
      );
      removeCount = parseInt(cnt.rows[0]?.c || '0', 10);
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          onlyWithoutShipment,
          contractsConsidered: contractRows.length,
          skipped_no_sap_processed_data: skippedNoSpd,
          skipped_not_land_contract: skippedNotLand,
          skipped_sap_still_eligible_for_trucking: skippedEligibleSap,
          landContractsToPurge: contractIdsToPurge.length,
          truckingRowsToRemove: removeCount,
        },
        null,
        2
      )
    );

    if (contractRows.length > 0 && contractIdsToPurge.length === 0) {
      console.log(
        'Nothing to purge: every contract was skipped (see counts). If this is a SEA contract with bogus trucking, use migrateSeaTruckingToShipments or diagnoseLandTruckingCleanup.ts.'
      );
    }

    if (contractIdsToPurge.length === 0) {
      await client.query('COMMIT');
      return;
    }

    if (dryRun) {
      console.log('Dry-run: would delete trucking for contract_ids:', contractIdsToPurge);
      await client.query('ROLLBACK');
      return;
    }

    const del = await client.query(`DELETE FROM trucking_operations WHERE ${deleteFilterSql}`, [contractIdsToPurge]);
    await client.query('COMMIT');
    console.log('Deleted', del.rowCount ?? 0, 'trucking_operations row(s).');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
