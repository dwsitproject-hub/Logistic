/**
 * Deduplicate trucking_operations: keep one row per contract_id, delete extras.
 * Keeper priority: progressed status > daily_deliverables > latest updated.
 *
 * Preview:  npx ts-node src/scripts/cleanupDuplicateTruckingPerContract.ts
 * Execute:  npx ts-node src/scripts/cleanupDuplicateTruckingPerContract.ts --confirm
 */

import { getClient } from '../database/connection';

const AUDIT_TABLE = 'cleanup_audit_duplicate_trucking_per_contract';

async function ensureAuditTable(client: Awaited<ReturnType<typeof getClient>>) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(32) NOT NULL DEFAULT 'trucking_operations',
      entity_id UUID NOT NULL,
      contract_id UUID,
      contract_number VARCHAR(64),
      po_number VARCHAR(64),
      operation_id TEXT,
      status VARCHAR(32),
      created_at TIMESTAMP,
      deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await ensureAuditTable(client);

    const preview = await client.query<{
      duplicate_contracts: string;
      rows_to_delete: string;
    }>(`
      WITH dup_contracts AS (
        SELECT contract_id
        FROM trucking_operations
        WHERE contract_id IS NOT NULL
          AND COALESCE(status, '') <> 'CANCELLED'
        GROUP BY contract_id
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::text AS duplicate_contracts,
        (
          SELECT COUNT(*)::text
          FROM trucking_operations t
          INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
          WHERE COALESCE(t.status, '') <> 'CANCELLED'
        ) AS rows_to_delete
      FROM dup_contracts
    `);

    const duplicateContracts = parseInt(preview.rows[0]?.duplicate_contracts ?? '0', 10);
    const totalRowsInDupGroups = parseInt(preview.rows[0]?.rows_to_delete ?? '0', 10);

    const sample = await client.query(`
      WITH dup_contracts AS (
        SELECT contract_id
        FROM trucking_operations
        WHERE contract_id IS NOT NULL
          AND COALESCE(status, '') <> 'CANCELLED'
        GROUP BY contract_id
        HAVING COUNT(*) > 1
      )
      SELECT c.contract_id AS contract_number,
             c.po_number,
             COUNT(*)::int AS row_count
      FROM trucking_operations t
      INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE COALESCE(t.status, '') <> 'CANCELLED'
      GROUP BY c.contract_id, c.po_number
      ORDER BY row_count DESC
      LIMIT 10
    `);

    const rowsToDelete = totalRowsInDupGroups - duplicateContracts;

    console.log(
      JSON.stringify(
        {
          mode: confirm ? 'execute' : 'preview',
          duplicate_contract_groups: duplicateContracts,
          trucking_rows_in_dup_groups: totalRowsInDupGroups,
          trucking_rows_to_delete: rowsToDelete,
          keepers_to_retain: duplicateContracts,
          sample_contracts: sample.rows,
          hint: confirm
            ? undefined
            : 'Re-run with --confirm to delete duplicate rows (one keeper per contract).',
        },
        null,
        2,
      ),
    );

    if (!confirm) {
      await client.query('ROLLBACK');
      return;
    }

    if (duplicateContracts === 0) {
      console.log(JSON.stringify({ message: 'No duplicate trucking operations per contract.' }));
      await client.query('COMMIT');
      return;
    }

    const deleted = await client.query<{ entity_id: string }>(`
      WITH dup_contracts AS (
        SELECT contract_id
        FROM trucking_operations
        WHERE contract_id IS NOT NULL
          AND COALESCE(status, '') <> 'CANCELLED'
        GROUP BY contract_id
        HAVING COUNT(*) > 1
      ),
      keepers AS (
        SELECT DISTINCT ON (t.contract_id)
          t.contract_id,
          t.id AS keeper_id
        FROM trucking_operations t
        INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
        WHERE COALESCE(t.status, '') <> 'CANCELLED'
        ORDER BY
          t.contract_id,
          CASE UPPER(COALESCE(t.status, ''))
            WHEN 'COMPLETED' THEN 1
            WHEN 'IN_PROGRESS' THEN 2
            WHEN 'IN_TRANSIT' THEN 3
            WHEN 'LOADING' THEN 4
            WHEN 'UNLOADING' THEN 5
            WHEN 'PLANNED' THEN 6
            ELSE 7
          END ASC,
          COALESCE(jsonb_array_length(t.daily_deliverables), 0) DESC,
          t.updated_at DESC NULLS LAST,
          t.created_at DESC,
          t.id DESC
      ),
      to_delete AS (
        SELECT
          t.id,
          t.contract_id,
          c.contract_id AS contract_number,
          c.po_number,
          t.operation_id,
          t.status,
          t.created_at
        FROM trucking_operations t
        INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
        INNER JOIN keepers k ON k.contract_id = t.contract_id
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE COALESCE(t.status, '') <> 'CANCELLED'
          AND t.id <> k.keeper_id
      ),
      audited AS (
        INSERT INTO ${AUDIT_TABLE} (
          entity_id, contract_id, contract_number, po_number, operation_id, status, created_at
        )
        SELECT id, contract_id, contract_number, po_number, operation_id, status, created_at
        FROM to_delete
        RETURNING entity_id
      )
      DELETE FROM trucking_operations t
      WHERE t.id IN (SELECT entity_id FROM audited)
      RETURNING t.id AS entity_id
    `);

    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          deleted_count: deleted.rowCount ?? deleted.rows.length,
          audit_table: AUDIT_TABLE,
          message: 'Duplicate trucking operations per contract removed (one keeper retained).',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
