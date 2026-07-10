import { query } from '../database/connection';
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
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query('TRUNCATE contract_latest_spd_snapshot');
    const insertRes = await query(buildContractLatestSpdSnapshotRefreshSql());
    const rowCount = insertRes.rowCount ?? 0;
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
