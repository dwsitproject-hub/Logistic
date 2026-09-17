/**
 * Rebuild the Contract Performance snapshot in batches.
 *
 * refreshAll() builds every contract in one statement. On the dev container (1 GiB) that reached
 * 985 MiB of 1024 MiB before being cancelled - and an OOM there does not just fail the query, it
 * kills the backend process and restarts the whole cluster (seen 2026-09-07, signal 9). The
 * targeted path narrows every CTE to the ids it is given, so the same work in chunks stays flat.
 *
 * Coverage is taken from `contracts` itself, so nothing is missed; is_stale is cleared only after
 * every chunk succeeded and the row count is verified.
 *
 *   npx ts-node src/scripts/rebuildCpSnapshotBatched.ts [--chunk=1500]
 */
import { query } from '../database/connection';
import {
  CONTRACT_PERFORMANCE_SNAPSHOT_TABLE,
  ContractPerformanceSnapshotService,
} from '../services/contractPerformanceSnapshot.service';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main(): Promise<void> {
  const chunkSize = Math.max(100, Number(arg('chunk') ?? 1500));
  const idsRes = await query(
    `SELECT DISTINCT contract_id FROM contracts
      WHERE NULLIF(TRIM(contract_id), '') IS NOT NULL
      ORDER BY contract_id`,
  );
  const ids = (idsRes.rows as { contract_id: string }[]).map((r) => r.contract_id);
  console.log(`[CPBATCH] ${ids.length} contracts, chunk=${chunkSize}`);

  const started = Date.now();
  let written = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const t0 = Date.now();
    const n = await ContractPerformanceSnapshotService.refreshForContracts(chunk);
    written += n;
    console.log(
      `[CPBATCH] ${String(i + chunk.length).padStart(6)}/${ids.length}  +${String(n).padStart(5)} rows  ${String(Date.now() - t0).padStart(6)}ms`,
    );
  }

  const countRes = await query(`SELECT COUNT(*)::int AS n FROM ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE}`);
  const rowCount = Number((countRes.rows[0] as { n: number }).n ?? 0);
  const durationMs = Date.now() - started;
  console.log(`[CPBATCH] wrote ${written} rows; table now holds ${rowCount}; ${durationMs}ms total`);

  if (rowCount === 0) {
    console.log('[CPBATCH] refusing to clear is_stale - the table is empty');
    process.exit(1);
  }

  await query(
    `UPDATE contract_performance_snapshot_meta
        SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
      WHERE id = 'global'`,
    [rowCount, durationMs],
  );
  console.log('[CPBATCH] is_stale cleared');

  /** Same housekeeping refreshAll does: a full generation of dead tuples plus fresh statistics. */
  await query(`VACUUM (ANALYZE) ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE}`);
  console.log('[CPBATCH] vacuum + analyze done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[CPBATCH] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});
