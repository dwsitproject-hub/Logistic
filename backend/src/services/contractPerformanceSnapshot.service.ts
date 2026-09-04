import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { buildContractPerformanceSnapshotRefreshSql } from '../utils/contractPerformanceSnapshotSql';

export const CONTRACT_PERFORMANCE_SNAPSHOT_TABLE = 'contract_performance_snapshot';

export async function isContractPerformanceSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM contract_performance_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markContractPerformanceSnapshotStale(): Promise<void> {
  await query(
    `UPDATE contract_performance_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
  );
}

export class ContractPerformanceSnapshotService {
  /**
   * Rebuild the whole snapshot.
   *
   * Three things this does deliberately differently from the older snapshot services, because
   * Contract Performance has no affordable live fallback (recomputing costs minutes, so a reader
   * that distrusts the snapshot cannot just fall back per request):
   *
   * 1. Marks the snapshot stale BEFORE touching it, and fresh only after a successful commit.
   *    The older services only ever set is_stale = FALSE at the end, and nothing ever set it to
   *    TRUE (markStale existed but had no callers), so the documented "fall back when stale" path
   *    was effectively dead and readers trusted the table even mid-rebuild.
   * 2. Does the delete and the re-insert in ONE transaction. The older services TRUNCATE and
   *    INSERT as separate autocommit statements, which leaves the table empty or half-filled -
   *    and visible as such - for the whole rebuild (measured ~60s for qty_move). DELETE rather
   *    than TRUNCATE so readers keep seeing the previous contents until the swap commits, instead
   *    of blocking on TRUNCATE's ACCESS EXCLUSIVE lock.
   * 3. Leaves is_stale = TRUE and logs at error level when the rebuild fails, so a failed refresh
   *    degrades to "slow but correct" instead of "fast but wrong". A silent catch here would show
   *    stale GR status and delivery/receive quantities as though they were current.
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await markContractPerformanceSnapshotStale();

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE}`);
      const insertRes = await client.query(await buildContractPerformanceSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('Contract performance snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_performance_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    logger.info('Contract performance snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }
}
