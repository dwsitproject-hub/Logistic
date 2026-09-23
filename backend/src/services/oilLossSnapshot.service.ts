import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { buildOilLossGainSql, buildOilLossMainSql } from '../utils/oilLossQuerySql';
import type { OilLossPayload } from './oilLoss.service';

export const OIL_LOSS_SNAPSHOT_TABLE = 'oil_loss_snapshot';
export const OIL_LOSS_SNAPSHOT_LOGIC_VERSION = 3;

const STALE_REFRESH_DEBOUNCE_MS = 60_000;

export type OilLossSnapshotMeta = {
  refreshedAt: Date | null;
  isStale: boolean;
  logicVersion: number;
  totalGainKg: number;
  gainCount: number;
};

/** True when the stored set is missing, flagged stale, or built by an older formula. */
export function oilLossSnapshotNeedsRebuild(
  meta: OilLossSnapshotMeta | null,
  logicVersion = OIL_LOSS_SNAPSHOT_LOGIC_VERSION,
): boolean {
  if (!meta?.refreshedAt) return true;
  if (meta.isStale) return true;
  return meta.logicVersion !== logicVersion;
}

const SNAPSHOT_COLUMNS = [
  'id',
  'transport_mode',
  'sto_type',
  'operation_id',
  'contract_number',
  'contract_ext_no',
  'sto_number',
  'po_number',
  'supplier',
  'buyer',
  'product',
  'group_name',
  'plant_site',
  'vessel_name',
  'contract_date',
  'operation_date',
  'incoterm',
  'group_plant',
  'quantity_contract',
  'transporter',
  'loading_location',
  'unloading_location',
  'status',
  'quantity_delivery',
  'quantity_received',
  'quantity_sent',
  'quantity_sfal',
  'quantity_sfbd',
  'gain_loss_amount',
  'gain_loss_percentage',
] as const;

let refreshInFlight: Promise<void> | null = null;
let lastStaleRefreshAt = 0;
/** An edit landed while a rebuild was already scanning. Run one more pass when it finishes. */
let rerunAfterCurrent = false;

export async function readOilLossSnapshotMeta(): Promise<OilLossSnapshotMeta | null> {
  const res = await query(
    `SELECT refreshed_at, is_stale, logic_version, total_gain_kg, gain_count
     FROM oil_loss_snapshot_meta
     WHERE id = 'global'
     LIMIT 1`,
  );
  const row = res.rows[0] as
    | {
        refreshed_at?: Date | null;
        is_stale?: boolean;
        logic_version?: number;
        total_gain_kg?: unknown;
        gain_count?: unknown;
      }
    | undefined;
  if (!row) return null;
  return {
    refreshedAt: row.refreshed_at ?? null,
    isStale: row.is_stale !== false,
    logicVersion: Number(row.logic_version ?? 0),
    totalGainKg: Number(row.total_gain_kg ?? 0),
    gainCount: Number(row.gain_count ?? 0),
  };
}

export async function markOilLossSnapshotStale(): Promise<void> {
  await query(`UPDATE oil_loss_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
}

/**
 * Rebuild the whole snapshot. Readers keep the previous rows until this transaction commits.
 * Concurrent callers share one execution.
 */
export function refreshOilLossSnapshot(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = rebuildOilLossSnapshot().finally(() => {
    refreshInFlight = null;
    if (!rerunAfterCurrent) return;
    rerunAfterCurrent = false;
    lastStaleRefreshAt = Date.now();
    void refreshOilLossSnapshot().catch((err) => {
      logger.warn('Background oil loss snapshot refresh failed', { err });
    });
  });
  return refreshInFlight;
}

/**
 * Rebuild after an upstream snapshot (qty_move) has committed.
 * If a scan started earlier — for example a page load while the import was still
 * writing qty_move — run one more pass so the stored rows see the new quantities.
 */
export function refreshOilLossSnapshotAfterCurrent(): Promise<void> {
  if (!refreshInFlight) return refreshOilLossSnapshot();
  rerunAfterCurrent = true;
  return refreshInFlight.then(() => refreshOilLossSnapshot());
}

export async function refreshOilLossSnapshotIfNeeded(): Promise<void> {
  const meta = await readOilLossSnapshotMeta();
  if (!oilLossSnapshotNeedsRebuild(meta)) return;
  logger.info('Oil loss snapshot stale — refreshing in background');
  await refreshOilLossSnapshot();
}

/** Mark stale and rebuild once per debounce window. The page keeps serving the last snapshot. */
export function scheduleOilLossSnapshotRefresh(): void {
  void markOilLossSnapshotStale().catch((err) => {
    logger.warn('Oil loss snapshot mark-stale failed', { err });
  });
  if (refreshInFlight) {
    rerunAfterCurrent = true;
    return;
  }
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    refreshOilLossSnapshot().catch((err) => {
      logger.warn('Background oil loss snapshot refresh failed', { err });
    });
  });
}

async function rebuildOilLossSnapshot(): Promise<void> {
  const start = Date.now();
  await markOilLossSnapshotStale();

  const client = await getClient();
  let rowCount = 0;
  let totalGainKg = 0;
  let gainCount = 0;
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${OIL_LOSS_SNAPSHOT_TABLE}`);
    const insertSql = `INSERT INTO ${OIL_LOSS_SNAPSHOT_TABLE} (${SNAPSHOT_COLUMNS.join(', ')})
      ${await buildOilLossMainSql()}`;
    const insertRes = await client.query(insertSql);
    rowCount = insertRes.rowCount ?? 0;
    const gainRes = await client.query(buildOilLossGainSql());
    const gainRow = gainRes.rows[0] as { total_gain_kg?: unknown; gain_count?: unknown } | undefined;
    totalGainKg = Number(gainRow?.total_gain_kg ?? 0);
    gainCount = Number(gainRow?.gain_count ?? 0);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be unusable
    }
    logger.error('Oil loss snapshot refresh failed - snapshot left stale', {
      err,
      durationMs: Date.now() - start,
    });
    throw err;
  } finally {
    client.release();
  }

  const durationMs = Date.now() - start;
  await query(
    `UPDATE oil_loss_snapshot_meta
     SET refreshed_at = NOW(),
         is_stale = FALSE,
         row_count = $1,
         duration_ms = $2,
         logic_version = $3,
         total_gain_kg = $4,
         gain_count = $5
     WHERE id = 'global'`,
    [rowCount, durationMs, OIL_LOSS_SNAPSHOT_LOGIC_VERSION, totalGainKg, gainCount],
  );

  try {
    const { rememberOilLossPayloadFromSnapshot } = await import('./oilLoss.service');
    await rememberOilLossPayloadFromSnapshot();
  } catch (err) {
    logger.warn('Oil loss memory cache fill after snapshot refresh failed', { err });
  }

  try {
    await query(`VACUUM (ANALYZE) ${OIL_LOSS_SNAPSHOT_TABLE}`);
  } catch (err) {
    logger.warn('Oil loss snapshot VACUUM ANALYZE failed - snapshot still usable', { err });
  }

  logger.info('Oil loss snapshot refreshed', { rowCount, durationMs, gainCount });
}

export async function loadOilLossPayloadFromSnapshot(): Promise<OilLossPayload | null> {
  const meta = await readOilLossSnapshotMeta();
  if (!meta?.refreshedAt) return null;
  const res = await query(
    `SELECT ${SNAPSHOT_COLUMNS.join(', ')}
     FROM ${OIL_LOSS_SNAPSHOT_TABLE}
     ORDER BY gain_loss_amount ASC NULLS LAST, id ASC`,
  );
  return {
    rows: res.rows as Record<string, unknown>[],
    gainRow: {
      total_gain_kg: meta.totalGainKg,
      gain_count: meta.gainCount,
    },
  };
}
