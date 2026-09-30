import { getClient, query } from '../database/connection';
import {
  buildContractStoAggSnapshotRefreshSql,
  buildContractStoAggSnapshotUpsertSql,
  buildStoAggCte,
  buildStoAggFromSnapshotCte,
} from '../utils/contractStoAggSql';
import logger from '../utils/logger';

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

export async function isContractStoAggSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM contract_sto_agg_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markContractStoAggSnapshotStale(): Promise<void> {
  await query(`UPDATE contract_sto_agg_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
  scheduleContractStoAggSnapshotRefreshIfNeeded();
}

function scheduleContractStoAggSnapshotRefreshIfNeeded(): void {
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    ContractStoAggSnapshotService.refreshAll().catch((err) => {
      logger.warn('Background contract sto_agg snapshot refresh failed', { err });
    });
  });
}

export class ContractStoAggSnapshotService {
  /**
   * Rebuild the whole snapshot.
   *
   * Same failure as latest_spd: TRUNCATE committed while is_stale stayed FALSE, so a dead
   * rebuild left meta claiming 5518 rows and the table at 0 (production 2026-09-30). Readers
   * that trust the flag then treat every contract as having no STO aggregate.
   *
   * Mark stale first (the live STO query takes over), swap rows in one transaction, and refuse
   * to publish a 0-row result as fresh.
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query(
      `UPDATE contract_sto_agg_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
    );

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM contract_sto_agg_snapshot');
      const insertRes = await client.query(buildContractStoAggSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      if (rowCount === 0) {
        throw new Error('Contract sto_agg snapshot refresh produced 0 rows');
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('Contract sto_agg snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_sto_agg_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    logger.info('Contract sto_agg snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }

  static async refreshForContracts(contractNumbers: string[]): Promise<number> {
    const ids = contractNumbers.map((c) => String(c).trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const insertRes = await query(buildContractStoAggSnapshotUpsertSql(), [ids]);
    return insertRes.rowCount ?? 0;
  }
}

/** Pick snapshot join or live sto_agg CTE (same output shape). */
export async function resolveContractsStoAggCte(scopeCteName = 'contract_scope'): Promise<string> {
  if (await isContractStoAggSnapshotFresh()) {
    return buildStoAggFromSnapshotCte(scopeCteName);
  }
  return buildStoAggCte({ kind: 'join_scope', scopeCteName });
}

export { buildStoAggFromSnapshotCte, buildStoAggCte };
