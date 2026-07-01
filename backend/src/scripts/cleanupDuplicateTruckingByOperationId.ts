/**
 * Remove trucking_operations that share the same operation_id across multiple rows
 * (cross-PO duplicate from unplanned upload before upsert guard).
 *
 * Deletes ALL rows in each duplicate operation_id group so POs can be re-uploaded
 * via the Unplanned template with one operation per PO.
 *
 * Preview:  npx ts-node src/scripts/cleanupDuplicateTruckingByOperationId.ts
 * Execute:  npx ts-node src/scripts/cleanupDuplicateTruckingByOperationId.ts --confirm
 */

import { getClient } from '../database/connection';

const AUDIT_TABLE = 'cleanup_audit_duplicate_trucking_op_id';

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
      duplicate_groups: string;
      rows_to_delete: string;
    }>(`
      WITH dup_op_ids AS (
        SELECT TRIM(t.operation_id::text) AS op_key
        FROM trucking_operations t
        WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
          AND COALESCE(t.status, '') <> 'CANCELLED'
        GROUP BY TRIM(t.operation_id::text)
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::text AS duplicate_groups,
        (SELECT COUNT(*)::text FROM trucking_operations t
         INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
         WHERE COALESCE(t.status, '') <> 'CANCELLED') AS rows_to_delete
      FROM dup_op_ids
    `);

    const duplicateGroups = parseInt(preview.rows[0]?.duplicate_groups ?? '0', 10);
    const rowsToDelete = parseInt(preview.rows[0]?.rows_to_delete ?? '0', 10);

    const sample = await client.query(`
      WITH dup_op_ids AS (
        SELECT TRIM(t.operation_id::text) AS op_key
        FROM trucking_operations t
        WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
          AND COALESCE(t.status, '') <> 'CANCELLED'
        GROUP BY TRIM(t.operation_id::text)
        HAVING COUNT(*) > 1
      )
      SELECT TRIM(t.operation_id::text) AS operation_id,
             STRING_AGG(DISTINCT c.po_number::text, ', ' ORDER BY c.po_number::text) AS po_numbers,
             COUNT(*)::int AS row_count
      FROM trucking_operations t
      INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE COALESCE(t.status, '') <> 'CANCELLED'
      GROUP BY TRIM(t.operation_id::text)
      ORDER BY operation_id
      LIMIT 10
    `);

    console.log(
      JSON.stringify(
        {
          mode: confirm ? 'execute' : 'preview',
          duplicate_operation_id_groups: duplicateGroups,
          trucking_rows_to_delete: rowsToDelete,
          sample_groups: sample.rows,
          hint: confirm
            ? undefined
            : 'Re-run with --confirm to delete all rows in duplicate operation_id groups.',
        },
        null,
        2,
      ),
    );

    if (!confirm) {
      await client.query('ROLLBACK');
      return;
    }

    if (rowsToDelete === 0) {
      console.log(JSON.stringify({ message: 'No duplicate trucking operations to delete.' }));
      await client.query('COMMIT');
      return;
    }

    const deleted = await client.query<{ entity_id: string }>(`
      WITH dup_op_ids AS (
        SELECT TRIM(t.operation_id::text) AS op_key
        FROM trucking_operations t
        WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
          AND COALESCE(t.status, '') <> 'CANCELLED'
        GROUP BY TRIM(t.operation_id::text)
        HAVING COUNT(*) > 1
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
        INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
        INNER JOIN contracts c ON c.id = t.contract_id
        WHERE COALESCE(t.status, '') <> 'CANCELLED'
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
          message:
            'Duplicate trucking operations removed. Re-upload Unplanned template per PO.',
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
