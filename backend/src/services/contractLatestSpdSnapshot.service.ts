import { getClient, query } from '../database/connection';
import {
  buildContractLatestSpdSnapshotRefreshSql,
  buildContractLatestSpdSnapshotUpsertSql,
  buildLatestSpdCte,
  buildLatestSpdFromSnapshotCte,
} from '../utils/contractLatestSpdSql';
import logger from '../utils/logger';

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

export async function isContractLatestSpdSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM contract_latest_spd_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markContractLatestSpdSnapshotStale(): Promise<void> {
  await query(`UPDATE contract_latest_spd_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
  scheduleContractLatestSpdSnapshotRefreshIfNeeded();
}

function scheduleContractLatestSpdSnapshotRefreshIfNeeded(): void {
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    ContractLatestSpdSnapshotService.refreshAll().catch((err) => {
      logger.warn('Background contract latest_spd snapshot refresh failed', { err });
    });
  });
}

export class ContractLatestSpdSnapshotService {
  /**
   * Rebuild the whole snapshot.
   *
   * This used to TRUNCATE and INSERT as two autocommit statements while is_stale stayed FALSE.
   * A restart after the truncate left the table at 0 rows and the meta still claiming fresh
   * (production 2026-09-30: meta row_count 19185, COUNT(*) 0). Contract Performance trusted that
   * flag, found no Region/Site, and returned an empty page.
   *
   * Mark stale first so readers use the live SPD query, then DELETE and INSERT in one
   * transaction so they never observe an empty table. A 0-row insert is a failure: publishing
   * it as fresh is the same outage. is_stale stays TRUE until a non-empty commit is recorded.
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query(
      `UPDATE contract_latest_spd_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
    );

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM contract_latest_spd_snapshot');
      const insertRes = await client.query(buildContractLatestSpdSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      if (rowCount === 0) {
        throw new Error('Contract latest_spd snapshot refresh produced 0 rows');
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('Contract latest_spd snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_latest_spd_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    logger.info('Contract latest_spd snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }

  static async refreshForContracts(contractNumbers: string[]): Promise<number> {
    const ids = contractNumbers.map((c) => String(c).trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const insertRes = await query(buildContractLatestSpdSnapshotUpsertSql(), [ids]);
    return insertRes.rowCount ?? 0;
  }
}

/** Pick snapshot join or live latest_spd CTE (same output shape). */
export async function resolveContractsLatestSpdCte(scopeCteName = 'contract_scope'): Promise<string> {
  if (await isContractLatestSpdSnapshotFresh()) {
    return buildLatestSpdFromSnapshotCte(scopeCteName);
  }
  return buildLatestSpdCte({ kind: 'join_scope', scopeCteName });
}

export { buildLatestSpdFromSnapshotCte, buildLatestSpdCte };
