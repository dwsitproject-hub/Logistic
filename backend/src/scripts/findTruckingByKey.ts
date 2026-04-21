/**
 * Find trucking_operations rows by key (contract_id / operation_id / ext no).
 *
 * Usage:
 *   cd backend
 *   npx ts-node src/scripts/findTruckingByKey.ts 1142000003239
 */

import { getClient } from '../database/connection';

async function main() {
  const key = String(process.argv[2] ?? '').trim();
  if (!key) {
    console.error('Usage: npx ts-node src/scripts/findTruckingByKey.ts <key>');
    process.exit(1);
  }

  const client = await getClient();
  try {
    const { rows: contractHits } = await client.query(
      `
      SELECT id AS contract_uuid, contract_id, transport_mode, po_number, sto_number
      FROM contracts
      WHERE TRIM(contract_id::text) = TRIM($1::text)
         OR contract_id ILIKE $2
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 20
      `,
      [key, `%${key}%`]
    );

    const contractUuids = contractHits.map((r: any) => r.contract_uuid);

    const { rows: truckByContract } = contractUuids.length
      ? await client.query(
          `
          SELECT id, contract_id, shipment_id, operation_id, status, created_at::text AS created_at
          FROM trucking_operations
          WHERE contract_id = ANY($1::uuid[])
          ORDER BY created_at DESC NULLS LAST
          LIMIT 100
          `,
          [contractUuids]
        )
      : { rows: [] as any[] };

    const { rows: truckByOp } = await client.query(
      `
      SELECT id, contract_id, shipment_id, operation_id, status, created_at::text AS created_at
      FROM trucking_operations
      WHERE operation_id ILIKE $1
      ORDER BY created_at DESC NULLS LAST
      LIMIT 100
      `,
      [`%${key}%`]
    );

    console.log(
      JSON.stringify(
        {
          key,
          contract_hits: contractHits,
          trucking_by_contract: truckByContract,
          trucking_by_operation_id: truckByOp,
        },
        null,
        2
      )
    );
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

