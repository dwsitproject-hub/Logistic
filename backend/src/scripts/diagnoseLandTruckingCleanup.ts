/**
 * Diagnose why a LAND trucking cleanup did/didn't delete trucking_operations.
 *
 * Pass either SAP "Contract Ext No" or the internal contract number (contracts.contract_id),
 * which is what the Contracts list usually shows as Contract No.
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
    console.error(
      'Usage: npx ts-node src/scripts/diagnoseLandTruckingCleanup.ts <contract_ext_no_or_contract_id>'
    );
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

    let lookupMode: 'spd_contract_ext_no' | 'contracts_contract_id' = 'spd_contract_ext_no';
    let contractNumbers: string[] = extRows.map((r) => r.contract_number);

    type ContractRow = {
      id: string;
      contract_id: string;
      transport_mode: string | null;
      created_at: string;
      updated_at: string;
    };

    let resolvedContractRows: ContractRow[] = [];
    if (extRows.length > 0) {
      const { rows } = await client.query<ContractRow>(
        `
        SELECT id, contract_id, transport_mode, created_at::text AS created_at, updated_at::text AS updated_at
        FROM contracts
        WHERE contract_id = ANY($1::text[])
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        `,
        [contractNumbers]
      );
      resolvedContractRows = rows;
    }

    if (extRows.length === 0 || resolvedContractRows.length === 0) {
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

      const { rows: directContracts } = await client.query<ContractRow>(
        `
        SELECT id, contract_id, transport_mode, created_at::text AS created_at, updated_at::text AS updated_at
        FROM contracts
        WHERE TRIM(contract_id) = TRIM($1)
           OR contract_id ILIKE $2
        ORDER BY (contract_id = TRIM($1)) DESC, updated_at DESC NULLS LAST
        LIMIT 20
        `,
        [key, `%${key}%`]
      );

      if (directContracts.length === 0) {
        console.log(
          JSON.stringify(
            {
              search_key: key,
              error: 'No match in sap_processed_data (Contract Ext No) and no row in contracts.contract_id',
              sample_spd_rows_matching_anywhere_in_json: anyHits,
              hint:
                anyHits.length > 0
                  ? 'The key appears somewhere in SPD JSON but not under Contract Ext No; try spd.contract_number from sample rows.'
                  : 'Confirm the number exists in contracts (B2B vs SAP numbering). Example: SELECT contract_id, contract_ext_no, transport_mode FROM contracts WHERE contract_id ILIKE \'%...%\';',
            },
            null,
            2
          )
        );
        return;
      }

      lookupMode = 'contracts_contract_id';
      resolvedContractRows = directContracts;
      contractNumbers = directContracts.map((c) => c.contract_id);
    }

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
      search_key: key,
      lookup_mode: lookupMode,
      lookup_note:
        lookupMode === 'contracts_contract_id'
          ? 'Resolved via contracts.contract_id (UI Contract No). Latest SAP row is loaded by spd.contract_number = contract_id when present.'
          : 'Resolved via sap_processed_data Contract Ext No → contract_number.',
      spd_matches_by_contract_ext_no: extRows.length > 0 ? extRows : undefined,
      contracts: [],
    };

    for (const c of resolvedContractRows) {
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

      const extFromSpd =
        latestSpd != null
          ? (() => {
              const d = latestSpd as Record<string, unknown>;
              const raw = d.raw as Record<string, unknown> | undefined;
              const contract = d.contract as Record<string, unknown> | undefined;
              const s = String(
                raw?.['Contract Ext No'] ?? raw?.['contract ext no'] ?? contract?.contract_ext_no ?? ''
              ).trim();
              return s || null;
            })()
          : null;

      out.contracts.push({
        contract_number: c.contract_id,
        contract_ext_no_from_latest_sap: extFromSpd,
        contract_uuid: c.id,
        transport_mode: c.transport_mode,
        has_latest_sap_row: latestSpd != null,
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

