/**
 * Diagnose why a LAND trucking cleanup did/didn't delete trucking_operations.
 *
 * Usage:
 *   cd backend
 *   npx ts-node src/scripts/diagnoseLandTruckingCleanup.ts 1142000003239
 */

import { getClient } from '../database/connection';
import {
  isContractLandForTruckingCleanup,
  isLandSapRowEligibleForTruckingCreation,
} from '../utils/landTruckingEligibility';

async function main() {
  const key = String(process.argv[2] ?? '').trim();
  if (!key) {
    console.error('Usage: npx ts-node src/scripts/diagnoseLandTruckingCleanup.ts <contract_ext_no>');
    process.exit(1);
  }

  const client = await getClient();
  try {
    const { rows: extRows } = await client.query<{
      contract_number: string;
      contract_ext_no: string | null;
      created_at: string;
    }>(
      `
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
        spd.created_at::text AS created_at
      FROM sap_processed_data spd
      WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')), '') IS NOT NULL
        AND TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) ILIKE $1
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      LIMIT 20
      `,
      [`%${key}%`]
    );

    if (extRows.length === 0) {
      const { rows: anyHits } = await client.query<{ contract_number: string; created_at: string }>(
        `
        SELECT spd.contract_number, spd.created_at::text AS created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL
          AND spd.data::text ILIKE $1
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 20
        `,
        [`%${key}%`]
      );
      console.log(
        JSON.stringify(
          {
            contract_ext_no: key,
            error: 'No sap_processed_data match found in Contract Ext No field',
            sample_spd_rows_matching_anywhere: anyHits,
            hint:
              anyHits.length > 0
                ? 'The value exists somewhere in SPD JSON but not in the Contract Ext No key used by UI.'
                : 'Value not found anywhere in SPD JSON. It may not be an SPD Contract Ext No in this DB, or the UI value comes from another source.',
          },
          null,
          2
        )
      );
      return;
    }

    const contractNumbers = extRows.map((r) => r.contract_number);

    const { rows: contractRows } = await client.query<{
      id: string;
      contract_id: string;
      transport_mode: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, contract_id, transport_mode, created_at::text AS created_at, updated_at::text AS updated_at
      FROM contracts
      WHERE contract_id = ANY($1::text[])
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      `,
      [contractNumbers]
    );

    const { rows: latestSpdRows } = await client.query<{ contract_number: string; data: any }>(
      `
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        spd.data
      FROM sap_processed_data spd
      WHERE spd.contract_number = ANY($1::text[])
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      `,
      [contractNumbers]
    );
    const spdByContract = new Map<string, any>();
    for (const r of latestSpdRows) spdByContract.set(String(r.contract_number), r.data);

    const out: any = {
      contract_ext_no: key,
      matches: extRows,
      contracts: [],
    };

    for (const c of contractRows) {
      const latestSpd = spdByContract.get(c.contract_id) ?? null;
      const isLand = isContractLandForTruckingCleanup(c.transport_mode, latestSpd);
      const eligible = latestSpd ? isLandSapRowEligibleForTruckingCreation(latestSpd) : null;

      const { rows: truckingRows } = await client.query<{
        id: string;
        shipment_id: string | null;
        operation_id: string | null;
        status: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        SELECT id,
               shipment_id,
               operation_id,
               status,
               created_at::text AS created_at,
               updated_at::text AS updated_at
        FROM trucking_operations
        WHERE contract_id = $1::uuid
        ORDER BY created_at DESC NULLS LAST
        LIMIT 50
        `,
        [c.id]
      );

      out.contracts.push({
        contract_number: c.contract_id,
        contract_uuid: c.id,
        transport_mode: c.transport_mode,
        is_land_for_cleanup: isLand,
        eligible_latest_spd_for_trucking: eligible,
        trucking_operations_count: truckingRows.length,
        trucking_operations: truckingRows,
      });
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

