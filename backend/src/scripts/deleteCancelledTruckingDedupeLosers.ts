/**
 * Hard-delete CANCELLED trucking_operations that are dedupe losers (Rule A ∪ Rule B).
 * Uses the same DB connection as the running backend (correct on SIT .60:5442).
 *
 * Rule A: CANCELLED + active keeper on same PO
 * Rule B: CANCELLED orphan (no keeper, no WB rows)
 *
 * Usage:
 *   node dist/scripts/deleteCancelledTruckingDedupeLosers.js
 *   node dist/scripts/deleteCancelledTruckingDedupeLosers.js --apply
 *   node dist/scripts/deleteCancelledTruckingDedupeLosers.js --apply --op OP-LAND-130720260012
 */
import { getClient } from '../database/connection';
import { invalidateTruckingListCache } from '../services/truckingList.service';
import { PipelineDailySummaryService } from '../services/pipelineDailySummary.service';

interface CancelledCandidateRow {
  id: string;
  contract_id: string | null;
  contract_number: string | null;
  po_number: string | null;
  operation_id: string | null;
  status: string | null;
  wb_rows: number;
  has_active_keeper: boolean;
  keeper_operation_id: string | null;
  delete_reason: 'active_keeper' | 'orphan_no_wb' | null;
}

const LIST_SQL = `
WITH cancelled AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    t.created_at,
    (
      SELECT COUNT(*)::int
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) AS wb_rows,
    EXISTS (
      SELECT 1
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
    ) AS has_active_keeper,
    (
      SELECT tk.operation_id
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
      ORDER BY tk.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS keeper_operation_id
  FROM trucking_operations t
  LEFT JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
),
classified AS (
  SELECT
    *,
    CASE
      WHEN has_active_keeper THEN 'active_keeper'
      WHEN wb_rows = 0 THEN 'orphan_no_wb'
      ELSE NULL
    END AS delete_reason
  FROM cancelled
)
SELECT * FROM classified
WHERE delete_reason IS NOT NULL
  AND ($1::text IS NULL OR TRIM(COALESCE(operation_id, '')) = TRIM($1::text))
ORDER BY po_number, operation_id
`;

async function ensureAuditTable(client: Awaited<ReturnType<typeof getClient>>): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cleanup_audit_cancelled_trucking_dedupe_losers (
      id SERIAL PRIMARY KEY,
      entity_id UUID NOT NULL,
      contract_id UUID,
      contract_number VARCHAR(64),
      po_number VARCHAR(64),
      operation_id TEXT,
      keeper_operation_id TEXT,
      status VARCHAR(32),
      created_at TIMESTAMP,
      deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delete_reason TEXT
    )
  `);
  await client.query(`
    ALTER TABLE cleanup_audit_cancelled_trucking_dedupe_losers
      ADD COLUMN IF NOT EXISTS delete_reason TEXT
  `);
}

async function listCandidates(
  client: Awaited<ReturnType<typeof getClient>>,
  opFilter: string | null,
): Promise<CancelledCandidateRow[]> {
  const res = await client.query<CancelledCandidateRow>(LIST_SQL, [opFilter]);
  return res.rows.map((r) => ({
    ...r,
    wb_rows: Number(r.wb_rows),
    has_active_keeper: Boolean(r.has_active_keeper),
    delete_reason: r.delete_reason as CancelledCandidateRow['delete_reason'],
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const opIdx = args.indexOf('--op');
  const opFilter =
    opIdx >= 0 && args[opIdx + 1] && !args[opIdx + 1].startsWith('--')
      ? String(args[opIdx + 1]).trim()
      : null;

  const client = await getClient();
  let deletedCount = 0;
  try {
    const candidates = await listCandidates(client, opFilter);
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      opFilter,
      wouldDelete: candidates.length,
      rows: candidates.map((r) => ({
        po_number: r.po_number,
        operation_id: r.operation_id,
        delete_reason: r.delete_reason,
        keeper_operation_id: r.keeper_operation_id,
        wb_rows: r.wb_rows,
      })),
    };
    console.log(JSON.stringify(report, null, 2));

    if (candidates.length === 0) {
      if (opFilter) {
        console.log(
          `\nNo eligible delete for operation_id=${opFilter}. Check: status=CANCELLED, active keeper on same PO, or orphan with wb_rows=0.`,
        );
      }
      return;
    }

    if (!apply) {
      console.log('\nDry-run only. Re-run with --apply to hard-delete and refresh pipeline.');
      return;
    }

    await ensureAuditTable(client);
    await client.query('BEGIN');
    for (const row of candidates) {
      await client.query(
        `INSERT INTO cleanup_audit_cancelled_trucking_dedupe_losers (
           entity_id, contract_id, contract_number, po_number,
           operation_id, keeper_operation_id, status, created_at, delete_reason
         )
         SELECT t.id, t.contract_id, c.contract_id, c.po_number,
                t.operation_id, $2, t.status, t.created_at, $3
         FROM trucking_operations t
         LEFT JOIN contracts c ON c.id = t.contract_id
         WHERE t.id = $1::uuid`,
        [row.id, row.keeper_operation_id, row.delete_reason],
      );
      await client.query(`DELETE FROM trucking_operations WHERE id = $1::uuid`, [row.id]);
    }
    await client.query('COMMIT');
    deletedCount = candidates.length;
    console.log(
      JSON.stringify(
        { applied: deletedCount, deletedOperationIds: candidates.map((r) => r.operation_id) },
        null,
        2,
      ),
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  if (deletedCount > 0) {
    invalidateTruckingListCache();
    console.log('Refreshing trucking pipeline summary...');
    const rowCount = await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();
    console.log(JSON.stringify({ pipelineRefreshed: true, rowCount }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
