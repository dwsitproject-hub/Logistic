import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../database/connection';

type Queryable = Pick<PoolClient, 'query'> | typeof query;

async function runQuery<T extends QueryResultRow = QueryResultRow>(
  db: Queryable,
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  if (typeof (db as PoolClient).query === 'function' && 'release' in (db as object)) {
    const result = await (db as PoolClient).query<T>(text, params);
    return { rows: result.rows };
  }
  const result = await query(text, params);
  return { rows: result.rows as T[] };
}

function toDateOrNull(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim().slice(0, 10);
}

export type TruckingRealizationRow = {
  id: string;
  trucking_operation_id: string;
  realization_start_date: string | null;
  realization_end_date: string | null;
  source: string;
  sap_synced_at: string | null;
};

export async function getTruckingRealizationByOperationId(
  truckingOperationId: string,
): Promise<TruckingRealizationRow | null> {
  const result = await query(
    `SELECT id, trucking_operation_id, realization_start_date, realization_end_date, source, sap_synced_at
     FROM trucking_realizations
     WHERE trucking_operation_id = $1
     LIMIT 1`,
    [truckingOperationId],
  );
  return (result.rows[0] as TruckingRealizationRow | undefined) ?? null;
}

export async function upsertTruckingRealization(
  executor: Queryable,
  truckingOperationId: string,
  input: {
    realizationStartDate?: unknown;
    realizationEndDate?: unknown;
    source?: string;
    userId?: string | null;
    markSapSynced?: boolean;
  },
): Promise<TruckingRealizationRow> {
  const start = toDateOrNull(input.realizationStartDate);
  const end = toDateOrNull(input.realizationEndDate);
  const source = String(input.source || 'manual').trim() || 'manual';
  const sapSyncedAt = input.markSapSynced ? new Date().toISOString() : null;

  const result = await runQuery<TruckingRealizationRow>(
    executor,
    `INSERT INTO trucking_realizations (
       trucking_operation_id,
       realization_start_date,
       realization_end_date,
       source,
       updated_by,
       sap_synced_at
     ) VALUES ($1, $2::date, $3::date, $4, $5::uuid, $6::timestamp)
     ON CONFLICT (trucking_operation_id) DO UPDATE SET
       realization_start_date = COALESCE(EXCLUDED.realization_start_date, trucking_realizations.realization_start_date),
       realization_end_date = COALESCE(EXCLUDED.realization_end_date, trucking_realizations.realization_end_date),
       source = CASE
         WHEN EXCLUDED.realization_start_date IS NOT NULL OR EXCLUDED.realization_end_date IS NOT NULL
         THEN EXCLUDED.source
         ELSE trucking_realizations.source
       END,
       updated_by = COALESCE(EXCLUDED.updated_by, trucking_realizations.updated_by),
       sap_synced_at = COALESCE(EXCLUDED.sap_synced_at, trucking_realizations.sap_synced_at),
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, trucking_operation_id, realization_start_date, realization_end_date, source, sap_synced_at`,
    [truckingOperationId, start, end, source, input.userId ?? null, sapSyncedAt],
  );
  return result.rows[0] as TruckingRealizationRow;
}

export type TruckingDailyActualRow = {
  progress_date: string;
  quantity_kg: number;
};

export async function listTruckingDailyActuals(
  truckingOperationId: string,
): Promise<TruckingDailyActualRow[]> {
  const result = await query(
    `SELECT progress_date::text AS progress_date, quantity_kg::float8 AS quantity_kg
     FROM trucking_daily_actuals
     WHERE trucking_operation_id = $1
     ORDER BY progress_date ASC`,
    [truckingOperationId],
  );
  return result.rows as TruckingDailyActualRow[];
}

export async function syncTruckingQuantityDeliveredFromDailyActuals(
  executor: Queryable,
  truckingOperationId: string,
): Promise<number> {
  const sumRes = await runQuery(
    executor,
    `SELECT COALESCE(SUM(quantity_kg), 0)::float8 AS total
     FROM trucking_daily_actuals
     WHERE trucking_operation_id = $1`,
    [truckingOperationId],
  );
  const total = Number(sumRes.rows[0]?.total ?? 0);
  await runQuery(
    executor,
    `UPDATE trucking_operations
     SET quantity_delivered = $2::numeric,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [truckingOperationId, total],
  );
  return total;
}

export type ResolveTruckingOperationResult =
  | { ok: true; operationId: string }
  | { ok: false; message: string };

async function listActiveTruckingOpsByPo(
  executor: Queryable,
  poNumber: string,
): Promise<Array<{ id: string; operation_id: string | null }>> {
  const result = await runQuery(
    executor,
    `SELECT t.id, t.operation_id
     FROM trucking_operations t
     LEFT JOIN contracts c ON t.contract_id = c.id
     WHERE COALESCE(t.status, '') <> 'CANCELLED'
       AND LOWER(TRIM(COALESCE(c.po_number::text, ''))) = LOWER(TRIM($1))
     ORDER BY t.updated_at DESC NULLS LAST, t.id ASC`,
    [poNumber],
  );
  return result.rows as Array<{ id: string; operation_id: string | null }>;
}

async function findTruckingOpByExtAndPo(
  executor: Queryable,
  contractExtNo: string,
  poNumber: string,
): Promise<string | null> {
  const result = await runQuery(
    executor,
    `SELECT t.id
     FROM trucking_operations t
     LEFT JOIN contracts c ON t.contract_id = c.id
     LEFT JOIN LATERAL (
       SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
       FROM sap_processed_data spd
       WHERE spd.contract_number = c.contract_id
       ORDER BY spd.created_at DESC NULLS LAST
       LIMIT 1
     ) spd ON true
     WHERE COALESCE(t.status, '') <> 'CANCELLED'
       AND (
         LOWER(TRIM(COALESCE(c.contract_id::text, ''))) = LOWER(TRIM($1))
         OR LOWER(TRIM(COALESCE(spd.contract_ext_no, ''))) = LOWER(TRIM($1))
       )
       AND LOWER(TRIM(COALESCE(c.po_number::text, ''))) = LOWER(TRIM($2))
     ORDER BY t.updated_at DESC NULLS LAST
     LIMIT 1`,
    [contractExtNo, poNumber],
  );
  return result.rows.length > 0 ? String(result.rows[0].id) : null;
}

export async function resolveTruckingOperationByExtNoAndPo(
  executor: Queryable,
  contractExtNo: string,
  poNumber?: string | null,
): Promise<ResolveTruckingOperationResult> {
  const key = String(contractExtNo ?? '').trim();
  const poTrim = poNumber != null ? String(poNumber).trim() : '';

  if (key && poTrim) {
    const byExtAndPo = await findTruckingOpByExtAndPo(executor, key, poTrim);
    if (byExtAndPo) return { ok: true, operationId: byExtAndPo };
  }

  if (poTrim) {
    const byPo = await listActiveTruckingOpsByPo(executor, poTrim);
    if (byPo.length === 1) {
      return { ok: true, operationId: String(byPo[0].id) };
    }
    if (byPo.length > 1) {
      const labels = byPo
        .map((o) => (o.operation_id && String(o.operation_id).trim()) || o.id)
        .join(', ');
      return {
        ok: false,
        message: `Multiple trucking operations share PO "${poTrim}" (${labels}). Ensure Contract Ext No matches or resolve duplicates.`,
      };
    }
  }

  if (key) {
    const byExtOnly = await runQuery(
      executor,
      `SELECT t.id
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) spd ON true
       WHERE COALESCE(t.status, '') <> 'CANCELLED'
         AND (
           LOWER(TRIM(COALESCE(c.contract_id::text, ''))) = LOWER(TRIM($1))
           OR LOWER(TRIM(COALESCE(spd.contract_ext_no, ''))) = LOWER(TRIM($1))
         )
       ORDER BY t.updated_at DESC NULLS LAST
       LIMIT 1`,
      [key],
    );
    if (byExtOnly.rows.length > 0) {
      return { ok: true, operationId: String(byExtOnly.rows[0].id) };
    }
  }

  if (poTrim && key) {
    return {
      ok: false,
      message: `No trucking operation found for Contract Ext No "${key}" and PO "${poTrim}"`,
    };
  }
  if (poTrim) {
    return { ok: false, message: `No trucking operation found for PO "${poTrim}"` };
  }
  return { ok: false, message: `No trucking operation found for Contract Ext No "${key}"` };
}

/** @deprecated Use resolveTruckingOperationByExtNoAndPo */
export async function resolveTruckingOperationIdByExtNoAndPo(
  executor: Queryable,
  contractExtNo: string,
  poNumber?: string | null,
): Promise<string | null> {
  const result = await resolveTruckingOperationByExtNoAndPo(executor, contractExtNo, poNumber);
  return result.ok ? result.operationId : null;
}

export async function replaceTruckingDailyActuals(
  executor: Queryable,
  truckingOperationId: string,
  rows: TruckingDailyActualRow[],
  source = 'manual',
): Promise<void> {
  const normalized = rows
    .map((r) => ({
      date: String(r.progress_date || '').trim().slice(0, 10),
      qty: Number(r.quantity_kg),
    }))
    .filter((r) => r.date && Number.isFinite(r.qty) && r.qty >= 0);

  await runQuery(executor, `DELETE FROM trucking_daily_actuals WHERE trucking_operation_id = $1`, [
    truckingOperationId,
  ]);

  for (const row of normalized) {
    await runQuery(
      executor,
      `INSERT INTO trucking_daily_actuals (trucking_operation_id, progress_date, quantity_kg, source)
       VALUES ($1, $2::date, $3::numeric, $4)
       ON CONFLICT (trucking_operation_id, progress_date) DO UPDATE SET
         quantity_kg = EXCLUDED.quantity_kg,
         source = EXCLUDED.source,
         updated_at = CURRENT_TIMESTAMP`,
      [truckingOperationId, row.date, row.qty, source],
    );
  }

  await syncTruckingQuantityDeliveredFromDailyActuals(executor, truckingOperationId);
  setImmediate(() => {
    import('./contractQtyMoveSnapshot.service')
      .then(({ ContractQtyMoveSnapshotService }) =>
        ContractQtyMoveSnapshotService.refreshForTruckingOperationIds([truckingOperationId]),
      )
      .catch(() => {});
  });
}

export async function upsertTruckingDailyActualRows(
  executor: Queryable,
  truckingOperationId: string,
  rows: TruckingDailyActualRow[],
  source = 'manual',
): Promise<void> {
  for (const row of rows) {
    const date = String(row.progress_date || '').trim().slice(0, 10);
    const qty = Number(row.quantity_kg);
    if (!date || !Number.isFinite(qty) || qty < 0) continue;
    await runQuery(
      executor,
      `INSERT INTO trucking_daily_actuals (trucking_operation_id, progress_date, quantity_kg, source)
       VALUES ($1, $2::date, $3::numeric, $4)
       ON CONFLICT (trucking_operation_id, progress_date) DO UPDATE SET
         quantity_kg = EXCLUDED.quantity_kg,
         source = EXCLUDED.source,
         updated_at = CURRENT_TIMESTAMP`,
      [truckingOperationId, date, qty, source],
    );
  }

  await syncTruckingQuantityDeliveredFromDailyActuals(executor, truckingOperationId);
  setImmediate(() => {
    import('./contractQtyMoveSnapshot.service')
      .then(({ ContractQtyMoveSnapshotService }) =>
        ContractQtyMoveSnapshotService.refreshForTruckingOperationIds([truckingOperationId]),
      )
      .catch(() => {});
  });
}

/** Derive DB status column from realization dates only (not planning). Last receive alone does not complete. */
export function deriveDbStatusFromRealization(
  currentStatus: unknown,
  realizationStart: unknown,
  _realizationEnd: unknown,
): string {
  const status = String(currentStatus ?? '').trim().toUpperCase();
  if (status === 'CANCELLED') return 'CANCELLED';
  if (realizationStart != null && String(realizationStart).trim() !== '') return 'IN_PROGRESS';
  return status || 'PLANNED';
}
