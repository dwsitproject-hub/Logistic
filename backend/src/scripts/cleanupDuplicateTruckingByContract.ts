/**
 * Deduplicate active trucking_operations per contract_id (keep one keeper, delete extras).
 *
 * Usage:
 *   cd backend
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByContract.ts           # dry-run (default)
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByContract.ts --apply   # delete duplicates
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByContract.ts --apply 1002000005514
 */

import { getClient } from '../database/connection';
import { SQL_TRUCKING_KEEPER_PRIORITY_ORDER } from '../utils/truckingOperationUniqueness';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const contractFilter = args.find((a) => a !== '--apply' && a !== '--dry-run')?.trim() || null;

  const client = await getClient();
  try {
    const filterSql = contractFilter
      ? `AND (
          c.contract_id = $1
          OR EXISTS (
            SELECT 1 FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
              AND TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No', '')) = $1
          )
        )`
      : '';
    const params = contractFilter ? [contractFilter] : [];

    const preview = await client.query(
      `
      WITH dup_contracts AS (
        SELECT t.contract_id
        FROM trucking_operations t
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE t.contract_id IS NOT NULL
          AND COALESCE(t.status, '') <> 'CANCELLED'
          ${filterSql}
        GROUP BY t.contract_id
        HAVING COUNT(*) > 1
      ),
      ranked AS (
        SELECT
          t.id,
          t.contract_id,
          c.contract_id AS contract_number,
          t.operation_id,
          t.status,
          t.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY t.contract_id
            ORDER BY ${SQL_TRUCKING_KEEPER_PRIORITY_ORDER}
          ) AS rn
        FROM trucking_operations t
        INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE COALESCE(t.status, '') <> 'CANCELLED'
      )
      SELECT
        contract_id,
        contract_number,
        id,
        operation_id,
        status,
        created_at,
        rn
      FROM ranked
      ORDER BY contract_number, rn
      `,
      params,
    );

    const rows = preview.rows as Array<{
      contract_id: string;
      contract_number: string;
      id: string;
      operation_id: string | null;
      status: string | null;
      created_at: string;
      rn: string;
    }>;

    if (rows.length === 0) {
      console.log(
        JSON.stringify(
          { mode: apply ? 'apply' : 'dry-run', contractFilter, message: 'No active duplicate trucking rows found' },
          null,
          2,
        ),
      );
      return;
    }

    const keepers = rows.filter((r) => Number(r.rn) === 1);
    const toDelete = rows.filter((r) => Number(r.rn) > 1);

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          contractFilter,
          duplicateContracts: keepers.length,
          rowsToDelete: toDelete.length,
          keepers: keepers.map((k) => ({
            contract_number: k.contract_number,
            operation_id: k.operation_id,
            status: k.status,
            id: k.id,
          })),
          delete: toDelete.map((d) => ({
            contract_number: d.contract_number,
            operation_id: d.operation_id,
            status: d.status,
            id: d.id,
          })),
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log('\nDry-run only. Re-run with --apply to delete duplicate rows.');
      return;
    }

    await client.query('BEGIN');
    const deleteIds = toDelete.map((d) => d.id);
    const del = await client.query(
      `DELETE FROM trucking_operations WHERE id = ANY($1::uuid[]) RETURNING id, operation_id`,
      [deleteIds],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ deleted: del.rowCount, deletedRows: del.rows }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
