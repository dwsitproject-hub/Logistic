import { PoolClient } from 'pg';
import logger from '../utils/logger';
import {
  SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE,
  sqlTruckingOpIsActiveForMatchingSql,
} from '../utils/truckingOperationUniqueness';
import { syncTruckingQuantityDeliveredFromDailyActuals } from './truckingRealization.service';
import { invalidateTruckingListCache } from './truckingList.service';
import { PipelineDailySummaryService } from './pipelineDailySummary.service';

export interface TruckingDedupeRankedRow {
  id: string;
  contract_id: string;
  po_number: string | null;
  operation_id: string | null;
  status: string | null;
  wb_dates: number;
  wb_qty_kg: number;
  rn: number;
}

export type TruckingDedupeMode = 'cancel' | 'soft_dedupe';

export interface TruckingDedupeOptions {
  /**
   * Skip async pipeline refresh after cancel.
   * Use for batch scripts that refresh once after COMMIT (avoids pool timeout storms).
   */
  skipPipelineRefresh?: boolean;
  /** cancel = legacy CANCELLED status; soft_dedupe = KLIP hygiene (hidden, not Cancelled card). */
  mode?: TruckingDedupeMode;
  dedupedReason?: string;
}

export interface TruckingDedupeResult {
  keeperId: string | null;
  cancelledIds: string[];
  dedupedIds: string[];
}

/** Coalesce concurrent refresh requests into one in-flight + one trailing run. */
let truckingPipelineRefreshPending = false;
let truckingPipelineRefreshRunning: Promise<void> | null = null;

export function scheduleTruckingPipelineRefresh(): void {
  truckingPipelineRefreshPending = true;
  if (truckingPipelineRefreshRunning) return;

  truckingPipelineRefreshRunning = (async () => {
    while (truckingPipelineRefreshPending) {
      truckingPipelineRefreshPending = false;
      try {
        await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();
      } catch (err) {
        logger.warn('scheduleTruckingPipelineRefresh: trucking pipeline refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })().finally(() => {
    truckingPipelineRefreshRunning = null;
    if (truckingPipelineRefreshPending) {
      scheduleTruckingPipelineRefresh();
    }
  });
}

async function mergeDailyActualsIntoKeeper(
  client: PoolClient,
  keeperId: string,
  loserId: string,
): Promise<number> {
  const res = await client.query(
    `INSERT INTO trucking_daily_actuals (
       trucking_operation_id,
       progress_date,
       quantity_kg,
       quantity_delivery_kg,
       quantity_receive_kg,
       source,
       wb_import_id,
       sto_number
     )
     SELECT
       $1::uuid,
       da.progress_date,
       da.quantity_kg,
       da.quantity_delivery_kg,
       da.quantity_receive_kg,
       da.source,
       da.wb_import_id,
       COALESCE(NULLIF(TRIM(da.sto_number), ''), '')
     FROM trucking_daily_actuals da
     WHERE da.trucking_operation_id = $2::uuid
     ON CONFLICT (trucking_operation_id, progress_date, sto_number) DO UPDATE SET
       quantity_kg = GREATEST(
         COALESCE(trucking_daily_actuals.quantity_kg, 0),
         COALESCE(EXCLUDED.quantity_kg, 0)
       ),
       quantity_delivery_kg = GREATEST(
         COALESCE(trucking_daily_actuals.quantity_delivery_kg, 0),
         COALESCE(EXCLUDED.quantity_delivery_kg, 0)
       ),
       quantity_receive_kg = GREATEST(
         COALESCE(trucking_daily_actuals.quantity_receive_kg, 0),
         COALESCE(EXCLUDED.quantity_receive_kg, 0)
       ),
       source = COALESCE(EXCLUDED.source, trucking_daily_actuals.source),
       wb_import_id = COALESCE(EXCLUDED.wb_import_id, trucking_daily_actuals.wb_import_id)`,
    [keeperId, loserId],
  );
  return res.rowCount ?? 0;
}

/**
 * Keep one active trucking op per contract (WB-complete keeper).
 * Merges loser daily actuals into keeper, then cancels or soft-dedupes losers.
 */
export async function dedupeActiveTruckingOpsForContract(
  client: PoolClient,
  contractUuid: string,
  options?: TruckingDedupeOptions,
): Promise<TruckingDedupeResult> {
  const mode: TruckingDedupeMode = options?.mode ?? 'cancel';
  const dedupedReason = String(options?.dedupedReason ?? 'manual_dedupe').trim() || 'manual_dedupe';

  const ranked = await client.query<TruckingDedupeRankedRow>(
    `WITH ranked AS (
       SELECT
         t.id,
         t.contract_id,
         c.po_number,
         t.operation_id,
         t.status,
         (
           SELECT COUNT(DISTINCT da.progress_date)::int
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS wb_dates,
         (
           SELECT COALESCE(SUM(
             COALESCE(da.quantity_delivery_kg, da.quantity_kg, 0)
             + COALESCE(da.quantity_receive_kg, 0)
           ), 0)::float8
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS wb_qty_kg,
         ROW_NUMBER() OVER (
           PARTITION BY t.contract_id
           ORDER BY ${SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE}
         ) AS rn
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       WHERE t.contract_id = $1::uuid
         AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
     )
     SELECT * FROM ranked
     ORDER BY rn`,
    [contractUuid],
  );

  if (ranked.rows.length <= 1) {
    return { keeperId: ranked.rows[0]?.id ?? null, cancelledIds: [], dedupedIds: [] };
  }

  const keeper = ranked.rows.find((r) => Number(r.rn) === 1)!;
  const losers = ranked.rows.filter((r) => Number(r.rn) > 1);
  const cancelledIds: string[] = [];
  const dedupedIds: string[] = [];

  for (const loser of losers) {
    const merged = await mergeDailyActualsIntoKeeper(client, keeper.id, loser.id);
    if (mode === 'soft_dedupe') {
      await client.query(
        `UPDATE trucking_operations
         SET deduped_at = CURRENT_TIMESTAMP,
             deduped_into_operation_id = $2::uuid,
             deduped_reason = $3::text,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        [loser.id, keeper.id, dedupedReason],
      );
      dedupedIds.push(loser.id);
      logger.info('dedupeActiveTruckingOpsForContract: soft-deduped duplicate', {
        contractUuid,
        keeperId: keeper.id,
        loserId: loser.id,
        dedupedReason,
        mergedActualRows: merged,
        keeperWbDates: keeper.wb_dates,
        loserWbDates: loser.wb_dates,
      });
    } else {
      await client.query(
        `UPDATE trucking_operations
         SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        [loser.id],
      );
      cancelledIds.push(loser.id);
      logger.info('dedupeActiveTruckingOpsForContract: cancelled duplicate', {
        contractUuid,
        keeperId: keeper.id,
        loserId: loser.id,
        mergedActualRows: merged,
        keeperWbDates: keeper.wb_dates,
        loserWbDates: loser.wb_dates,
      });
    }
  }

  await syncTruckingQuantityDeliveredFromDailyActuals(client, keeper.id);

  if (cancelledIds.length > 0 || dedupedIds.length > 0) {
    invalidateTruckingListCache();
    if (!options?.skipPipelineRefresh) {
      scheduleTruckingPipelineRefresh();
    }
  }

  return { keeperId: keeper.id, cancelledIds, dedupedIds };
}

/**
 * Dedupe all active trucking ops that share the same PO number.
 */
export async function dedupeActiveTruckingOpsForPo(
  client: PoolClient,
  poNumber: string,
  options?: TruckingDedupeOptions,
): Promise<TruckingDedupeResult & { contractUuid: string | null }> {
  const po = String(poNumber ?? '').trim();
  if (!po) return { keeperId: null, cancelledIds: [], dedupedIds: [], contractUuid: null };

  const contracts = await client.query<{ id: string }>(
    `SELECT id FROM contracts
     WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text)
     LIMIT 1`,
    [po],
  );
  const contractUuid = contracts.rows[0]?.id ?? null;
  if (!contractUuid) return { keeperId: null, cancelledIds: [], dedupedIds: [], contractUuid: null };

  await client.query(
    `UPDATE trucking_operations t
     SET contract_id = $1::uuid, updated_at = CURRENT_TIMESTAMP
     FROM contracts c
     WHERE t.contract_id = c.id
       AND TRIM(COALESCE(c.po_number::text, '')) = TRIM($2::text)
       AND t.contract_id <> $1::uuid
       AND ${sqlTruckingOpIsActiveForMatchingSql('t')}`,
    [contractUuid, po],
  );

  const result = await dedupeActiveTruckingOpsForContract(client, contractUuid, options);
  return { ...result, contractUuid };
}

export async function listDuplicateTruckingByPo(
  client: PoolClient,
  poFilter: string | null,
): Promise<TruckingDedupeRankedRow[]> {
  const params: string[] = [];
  let filterSql = '';
  if (poFilter) {
    params.push(poFilter);
    filterSql = `AND TRIM(COALESCE(c.po_number::text, '')) = TRIM($1::text)`;
  }

  const res = await client.query<TruckingDedupeRankedRow>(
    `WITH dup_pos AS (
       SELECT TRIM(COALESCE(c.po_number::text, '')) AS po_norm
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       WHERE t.contract_id IS NOT NULL
         AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
         AND NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
         ${filterSql}
       GROUP BY TRIM(COALESCE(c.po_number::text, ''))
       HAVING COUNT(*) > 1
     ),
     ranked AS (
       SELECT
         t.id,
         t.contract_id,
         c.po_number,
         t.operation_id,
         t.status,
         (
           SELECT COUNT(DISTINCT da.progress_date)::int
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS wb_dates,
         (
           SELECT COALESCE(SUM(
             COALESCE(da.quantity_delivery_kg, da.quantity_kg, 0)
             + COALESCE(da.quantity_receive_kg, 0)
           ), 0)::float8
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS wb_qty_kg,
         ROW_NUMBER() OVER (
           PARTITION BY TRIM(COALESCE(c.po_number::text, ''))
           ORDER BY ${SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE}
         ) AS rn
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       INNER JOIN dup_pos d ON d.po_norm = TRIM(COALESCE(c.po_number::text, ''))
       WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
     )
     SELECT * FROM ranked
     ORDER BY po_number, rn`,
    params,
  );
  return res.rows.map((r) => ({ ...r, rn: Number(r.rn) }));
}
