import { query } from '../database/connection';
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
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query('TRUNCATE b2b_ending_child_snapshot');
    const insertRes = await query(buildB2bEndingChildSnapshotRefreshSql());
    const rowCount = insertRes.rowCount ?? 0;
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
