/**
 * Deletes SEA shipments whose contract's latest sap_processed_data row does not satisfy
 * isSeaSapRowEligibleForShipmentCreation (false "shipping" operations).
 *
 * By default, excludes manual/migration-created shipments (shipment_id starts with MNL- or MSEA-).
 * Use --include-manual to also delete those.
 *
 * Run: cd backend && npx ts-node src/scripts/removeFalseSeaShipments.ts
 * Dry-run: ... --dry-run
 * Scope a key (contract id / ext no): ... --dry-run 9244100022
 */

import { getClient } from '../database/connection';
import logger from '../utils/logger';
import { isSeaSapRowEligibleForShipmentCreation } from '../utils/seaShipmentEligibility';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const includeManual = process.argv.includes('--include-manual');

  const scriptIdx = process.argv.findIndex((a) =>
    String(a).replace(/\\/g, '/').endsWith('/removeFalseSeaShipments.ts')
  );
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
        WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')), '') IS NOT NULL
          AND TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) ILIKE $1
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
      contract_uuid: string;
      contract_number: string;
      transport_mode: string | null;
    }>(
      `
      SELECT DISTINCT
        c.id AS contract_uuid,
        c.contract_id AS contract_number,
        c.transport_mode
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE ($1::text[] IS NULL OR c.contract_id = ANY($1::text[]))
      `,
      [onlyContractNumbers]
    );

    if (contractRows.length === 0) {
      console.log('No contracts with shipments found for the provided scope.');
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
    for (const r of spdRows) spdByContract.set(String(r.contract_number), r.data);

    const contractUuidsToPurge: string[] = [];
    let skippedNoSpd = 0;
    let skippedNotSea = 0;
    let skippedEligibleSap = 0;

    for (const row of contractRows) {
      const spd = spdByContract.get(row.contract_number);
      if (spd == null) {
        skippedNoSpd++;
        continue;
      }
      const tm = String(row.transport_mode || '').toUpperCase();
      if (!tm.startsWith('SEA')) {
        skippedNotSea++;
        continue;
      }
      if (isSeaSapRowEligibleForShipmentCreation(spd)) {
        skippedEligibleSap++;
        continue;
      }
      contractUuidsToPurge.push(row.contract_uuid);
    }

    const shipFilter = includeManual
      ? `contract_id = ANY($1::uuid[])`
      : `contract_id = ANY($1::uuid[]) AND shipment_id NOT LIKE 'MNL-%' AND shipment_id NOT LIKE 'MSEA-%'`;

    let removeCount = 0;
    if (contractUuidsToPurge.length > 0) {
      const cnt = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM shipments WHERE ${shipFilter}`,
        [contractUuidsToPurge]
      );
      removeCount = parseInt(cnt.rows[0]?.c || '0', 10);
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          includeManual,
          contractsConsidered: contractRows.length,
          skipped_no_sap_processed_data: skippedNoSpd,
          skipped_not_sea_contract: skippedNotSea,
          skipped_sap_still_eligible_for_shipping: skippedEligibleSap,
          seaContractsToPurge: contractUuidsToPurge.length,
          shipmentsToRemove: removeCount,
        },
        null,
        2
      )
    );

    if (contractUuidsToPurge.length === 0) {
      await client.query('COMMIT');
      return;
    }

    if (dryRun) {
      console.log('Dry-run: would delete shipments for contract_uuids:', contractUuidsToPurge);
      await client.query('ROLLBACK');
      return;
    }

    const del = await client.query(`DELETE FROM shipments WHERE ${shipFilter}`, [contractUuidsToPurge]);
    await client.query('COMMIT');
    logger.info('Deleted shipments', { count: del.rowCount ?? 0 });
    console.log('Deleted', del.rowCount ?? 0, 'shipment row(s).');
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

