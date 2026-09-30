import { getClient, query } from '../database/connection';
import { buildB2bEndingChildSnapshotRefreshSql } from '../utils/b2bOriginEndingSql';
import logger from '../utils/logger';

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

export async function isB2bEndingChildSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM b2b_ending_child_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markB2bEndingChildSnapshotStale(): Promise<void> {
  await query(`UPDATE b2b_ending_child_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
  scheduleB2bEndingChildSnapshotRefreshIfNeeded();
}

function scheduleB2bEndingChildSnapshotRefreshIfNeeded(): void {
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    B2bEndingChildSnapshotService.refreshAll().catch((err) => {
      logger.warn('Background B2B ending-child snapshot refresh failed', { err });
    });
  });
}

export class B2bEndingChildSnapshotService {
  /**
   * Rebuild the whole snapshot.
   *
   * Same failure as latest_spd: TRUNCATE committed while is_stale stayed FALSE, so a dead
   * rebuild left meta claiming 589 rows and the table at 0 (production 2026-09-30). Unlike
   * latest_spd, list SQL joins this table directly, so an empty-but-fresh snapshot drops the
   * B2B ending overlay with no live fallback.
   *
   * Mark stale first, swap rows in one transaction, and refuse to publish a 0-row result as
   * fresh. Readers also require the fresh flag (sqlB2bEndingChildSnapshotFreshGuard).
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query(
      `UPDATE b2b_ending_child_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
    );

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM b2b_ending_child_snapshot');
      const insertRes = await client.query(buildB2bEndingChildSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      if (rowCount === 0) {
        throw new Error('B2B ending-child snapshot refresh produced 0 rows');
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('B2B ending-child snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - start;
    await query(
      `UPDATE b2b_ending_child_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    logger.info('B2B ending-child snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }
}
