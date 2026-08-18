import { query } from '../database/connection';

export type ActiveTruckingOpRow = {
  id: string;
  operation_id: string | null;
  status: string | null;
  quantity_delivered?: unknown;
  delivery_start_date?: unknown;
  delivery_end_date?: unknown;
  eta_delivery_start_date?: unknown;
  eta_delivery_end_date?: unknown;
  eta_trucking_start_date?: unknown;
  eta_trucking_completion_date?: unknown;
  trucking_start_date?: unknown;
  trucking_completion_date?: unknown;
};

export type ContractByExtNoRow = {
  id: string;
  delivery_start_date?: unknown;
  delivery_end_date?: unknown;
};

/** Active = not CANCELLED (matches manual-create guard; SAP upsert paths are separate). */
export function isActiveTruckingStatus(status: unknown): boolean {
  return String(status ?? '').toUpperCase() !== 'CANCELLED';
}

/** KLIP soft-dedupe losers are hidden from list and matching (not the Cancelled card). */
export function sqlTruckingOpExcludeDedupedSql(truckingAlias = 't'): string {
  return `${truckingAlias}.deduped_at IS NULL`;
}

/** Operational rows eligible for WB / planning / duplicate guards. */
export function sqlTruckingOpIsActiveForMatchingSql(truckingAlias = 't'): string {
  return `(
    COALESCE(${truckingAlias}.status, '') <> 'CANCELLED'
    AND ${sqlTruckingOpExcludeDedupedSql(truckingAlias)}
  )`;
}

/** Visible in trucking list and pipeline summaries (excludes soft-deduped; Cancelled shown only on card filter). */
export function sqlTruckingOpIsListVisibleSql(truckingAlias = 't'): string {
  return sqlTruckingOpExcludeDedupedSql(truckingAlias);
}

/** Append to trucking list / pipeline base WHERE (alias `t`). */
export const truckingListExcludeDedupedWhereSql = `AND ${sqlTruckingOpIsListVisibleSql('t')}`;

export function formatDuplicateTruckingMessage(ops: Pick<ActiveTruckingOpRow, 'operation_id' | 'id'>[]): string {
  const labels = ops.map((o) => (o.operation_id && String(o.operation_id).trim()) || o.id);
  return `Contract already has trucking operation(s): ${labels.join(', ')}. Edit the existing operation or cancel it before creating a new one.`;
}

export async function findActiveTruckingOpsByContractId(contractUuid: string): Promise<ActiveTruckingOpRow[]> {
  const result = await query(
    `SELECT
       t.id,
       t.operation_id,
       t.status,
       t.quantity_delivered,
       c.delivery_start_date,
       c.delivery_end_date,
       t.eta_delivery_start_date,
       t.eta_delivery_end_date,
       t.eta_trucking_start_date,
       t.eta_trucking_completion_date,
       t.trucking_start_date,
       t.trucking_completion_date
     FROM trucking_operations t
     LEFT JOIN contracts c ON c.id = t.contract_id
     WHERE t.contract_id = $1::uuid
       AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
     ORDER BY t.created_at ASC, t.id ASC`,
    [contractUuid],
  );
  return result.rows as ActiveTruckingOpRow[];
}

export function truckingOperationIdIsAssigned(operationId: unknown): boolean {
  return String(operationId ?? '').trim().length > 0;
}

export type ContractForUnplannedPlanningRow = ContractByExtNoRow & {
  po_number?: string | null;
  transport_mode?: string | null;
};

/** Resolve LAND contract by PO (preferred) or Contract Ext No / contract_id. */
export async function resolveContractForUnplannedPlanningUpload(args: {
  poNumber?: string;
  contractExtNo?: string;
}): Promise<ContractForUnplannedPlanningRow | null> {
  const po = String(args.poNumber ?? '').trim();
  const ext = String(args.contractExtNo ?? '').trim();
  if (!po && !ext) return null;

  const params: string[] = [];
  const matchParts: string[] = [];
  if (po) {
    params.push(po);
    matchParts.push(`TRIM(COALESCE(c.po_number::text, '')) = TRIM($${params.length}::text)`);
  }
  if (ext) {
    params.push(ext);
    const p = `$${params.length}::text`;
    matchParts.push(`(
      TRIM(UPPER(COALESCE(l.contract_ext_no, ''))) = TRIM(UPPER(${p}))
      OR TRIM(c.contract_id::text) = TRIM(${p})
    )`);
  }
  const matchSql = matchParts.length === 1 ? matchParts[0] : matchParts.join(' AND ');

  const result = await query(
    `WITH latest_spd AS (
       SELECT DISTINCT ON (spd.contract_number)
         spd.contract_number,
         COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
       FROM sap_processed_data spd
       WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
       ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
     )
     SELECT c.id, c.delivery_start_date, c.delivery_end_date, c.po_number, c.transport_mode
     FROM contracts c
     LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
     WHERE ${matchSql}
     ORDER BY
       CASE
         WHEN $${params.length + 1}::text IS NOT NULL
           AND TRIM(COALESCE(c.po_number::text, '')) = TRIM($${params.length + 1}::text)
           THEN 0
         ELSE 1
       END,
       c.updated_at DESC NULLS LAST,
       c.created_at DESC
     LIMIT 1`,
    [...params, po || null],
  );
  return (result.rows[0] as ContractForUnplannedPlanningRow | undefined) ?? null;
}

export type UnplannedPlanningTruckingOpRow = ActiveTruckingOpRow & {
  contract_id: string;
  daily_deliverables: unknown;
  daily_actuals?: unknown;
  contract_po_number: string | null;
  contract_number: string | null;
  contract_ext_no: string | null;
  duplicate_sibling_count: number;
};

/**
 * Resolve a single trucking operation for Unplanned planning upload.
 * When PO is present, match by PO only (Contract Ext No is informational — ext mismatch must not block lookup).
 */
export async function findTruckingOpForUnplannedPlanningUpload(args: {
  poNumber?: string;
  contractExtNo?: string;
}): Promise<UnplannedPlanningTruckingOpRow | null> {
  const po = String(args.poNumber ?? '').trim();
  const ext = String(args.contractExtNo ?? '').trim();
  if (!po && !ext) return null;

  const params: string[] = [];
  let matchSql: string;
  if (po) {
    params.push(po);
    matchSql = `TRIM(COALESCE(c.po_number::text, '')) = TRIM($${params.length}::text)`;
  } else {
    params.push(ext);
    const p = `$${params.length}::text`;
    matchSql = `(
      TRIM(UPPER(COALESCE(ext.ext_no, ''))) = TRIM(UPPER(${p}))
      OR TRIM(c.contract_id::text) = TRIM(${p})
    )`;
  }

  const result = await query(
    `WITH candidates AS (
       SELECT
         t.id,
         t.contract_id,
         t.operation_id,
         t.status,
         t.quantity_delivered,
         t.daily_deliverables,
         (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'date', to_char(da.progress_date, 'YYYY-MM-DD'),
                 'quantity_delivered', da.quantity_kg
               )
               ORDER BY da.progress_date
             ),
             '[]'::jsonb
           )
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS daily_actuals,
         c.delivery_start_date,
         c.delivery_end_date,
         t.eta_delivery_start_date,
         t.eta_delivery_end_date,
         t.eta_trucking_start_date,
         t.eta_trucking_completion_date,
         t.trucking_start_date,
         t.trucking_completion_date,
         c.po_number AS contract_po_number,
         c.contract_id AS contract_number,
         ext.ext_no AS contract_ext_no,
         COUNT(*) OVER () AS duplicate_sibling_count,
         ROW_NUMBER() OVER (
           ORDER BY
             CASE
               WHEN NULLIF(TRIM(COALESCE(t.operation_id::text, '')), '') IS NOT NULL THEN 0
               ELSE 1
             END,
             ${SQL_TRUCKING_KEEPER_PRIORITY_ORDER}
         ) AS rn
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       LEFT JOIN LATERAL (
         SELECT NULLIF(TRIM(COALESCE(
           spd.data->'raw'->>'Contract Ext No',
           spd.data->>'Contract Ext No'
         )), '') AS ext_no
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) ext ON true
       WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
         AND (${matchSql})
     )
     SELECT *
     FROM candidates
     WHERE rn = 1
     LIMIT 1`,
    params,
  );
  return (result.rows[0] as UnplannedPlanningTruckingOpRow | undefined) ?? null;
}

/**
 * Resolve Planned / In Progress trucking operation for planning re-upload (match PO / Contract Ext No).
 */
export async function findTruckingOpForPlannedPlanningUpload(args: {
  poNumber?: string;
  contractExtNo?: string;
}): Promise<UnplannedPlanningTruckingOpRow | null> {
  const po = String(args.poNumber ?? '').trim();
  const ext = String(args.contractExtNo ?? '').trim();
  if (!po && !ext) return null;

  const params: string[] = [];
  const matchParts: string[] = [];
  if (po) {
    params.push(po);
    matchParts.push(`TRIM(COALESCE(c.po_number::text, '')) = TRIM($${params.length}::text)`);
  }
  if (ext) {
    params.push(ext);
    const p = `$${params.length}::text`;
    matchParts.push(`(
      TRIM(UPPER(COALESCE(ext.ext_no, ''))) = TRIM(UPPER(${p}))
      OR TRIM(c.contract_id::text) = TRIM(${p})
    )`);
  }
  const matchSql = matchParts.length === 1 ? matchParts[0] : matchParts.join(' AND ');

  const result = await query(
    `WITH candidates AS (
       SELECT
         t.id,
         t.contract_id,
         t.operation_id,
         t.status,
         t.quantity_delivered,
         t.daily_deliverables,
         (
           SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'date', to_char(da.progress_date, 'YYYY-MM-DD'),
                 'quantity_delivered', da.quantity_kg
               )
               ORDER BY da.progress_date
             ),
             '[]'::jsonb
           )
           FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
         ) AS daily_actuals,
         c.delivery_start_date,
         c.delivery_end_date,
         t.eta_delivery_start_date,
         t.eta_delivery_end_date,
         t.eta_trucking_start_date,
         t.eta_trucking_completion_date,
         t.trucking_start_date,
         t.trucking_completion_date,
         c.po_number AS contract_po_number,
         c.contract_id AS contract_number,
         ext.ext_no AS contract_ext_no,
         COUNT(*) OVER () AS duplicate_sibling_count,
         ROW_NUMBER() OVER (
           ORDER BY
             CASE
               WHEN NULLIF(TRIM(COALESCE(t.operation_id::text, '')), '') IS NOT NULL THEN 0
               ELSE 1
             END,
             ${SQL_TRUCKING_KEEPER_PRIORITY_ORDER}
         ) AS rn
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       LEFT JOIN LATERAL (
         SELECT NULLIF(TRIM(COALESCE(
           spd.data->'raw'->>'Contract Ext No',
           spd.data->>'Contract Ext No'
         )), '') AS ext_no
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) ext ON true
       WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
         AND UPPER(COALESCE(t.status, '')) IN ('PLANNED', 'IN_PROGRESS')
         AND (${matchSql})
     )
     SELECT *
     FROM candidates
     WHERE rn = 1
     LIMIT 1`,
    params,
  );
  return (result.rows[0] as UnplannedPlanningTruckingOpRow | undefined) ?? null;
}

/** Resolve LAND contract by Contract Ext No or contract_id text. */
export async function resolveContractByExtNoOrId(extNoOrId: string): Promise<ContractByExtNoRow | null> {
  const key = String(extNoOrId ?? '').trim();
  if (!key) return null;
  const result = await query(
    `WITH latest_spd AS (
       SELECT DISTINCT ON (spd.contract_number)
         spd.contract_number,
         COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
       FROM sap_processed_data spd
       WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
       ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
     )
     SELECT c.id, c.delivery_start_date, c.delivery_end_date
     FROM contracts c
     LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
     WHERE TRIM(UPPER(COALESCE(l.contract_ext_no, ''))) = TRIM(UPPER($1::text))
        OR TRIM(c.contract_id::text) = TRIM($1::text)
     ORDER BY (c.contract_id = $1) DESC
     LIMIT 1`,
    [key],
  );
  return (result.rows[0] as ContractByExtNoRow | undefined) ?? null;
}

/** SQL fragment: keeper row per contract_id among active trucking ops (for dedupe scripts/migrations). */
export const SQL_TRUCKING_KEEPER_PRIORITY_ORDER = `
  CASE UPPER(COALESCE(t.status, ''))
    WHEN 'COMPLETED' THEN 1
    WHEN 'IN_PROGRESS' THEN 2
    WHEN 'IN_TRANSIT' THEN 3
    WHEN 'LOADING' THEN 4
    WHEN 'UNLOADING' THEN 5
    WHEN 'PLANNED' THEN 6
    ELSE 7
  END ASC,
  CASE
    WHEN NULLIF(TRIM(t.loading_location), '') IS NOT NULL
      OR NULLIF(TRIM(t.unloading_location), '') IS NOT NULL
    THEN 0 ELSE 1
  END ASC,
  COALESCE(jsonb_array_length(t.daily_deliverables), 0) DESC,
  t.updated_at DESC NULLS LAST,
  t.created_at DESC,
  t.id DESC
`.trim();

/**
 * Prefer the op with more complete WB daily actuals, then fall back to status/planning priority.
 * Alias `t` must be trucking_operations.
 */
export const SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE = `
  (
    SELECT COUNT(DISTINCT da.progress_date)
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = t.id
  ) DESC,
  (
    SELECT COALESCE(SUM(
      COALESCE(da.quantity_delivery_kg, da.quantity_kg, 0)
      + COALESCE(da.quantity_receive_kg, 0)
    ), 0)
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = t.id
  ) DESC,
  ${SQL_TRUCKING_KEEPER_PRIORITY_ORDER}
`.trim();

export interface TruckingWbKeeperScore {
  wbDistinctDates: number;
  wbQtySumKg: number;
  statusRank: number;
  dailyDeliverablesLen: number;
  updatedAtMs: number;
  id: string;
}

const STATUS_RANK: Record<string, number> = {
  COMPLETED: 1,
  IN_PROGRESS: 2,
  IN_TRANSIT: 3,
  LOADING: 4,
  UNLOADING: 5,
  PLANNED: 6,
};

export function truckingStatusKeeperRank(status: unknown): number {
  const key = String(status ?? '').trim().toUpperCase();
  return STATUS_RANK[key] ?? 7;
}

/** Pure comparator: return <0 if a should rank before b (a is better keeper). */
export function compareTruckingWbCompleteKeepers(
  a: TruckingWbKeeperScore,
  b: TruckingWbKeeperScore,
): number {
  if (b.wbDistinctDates !== a.wbDistinctDates) return b.wbDistinctDates - a.wbDistinctDates;
  if (b.wbQtySumKg !== a.wbQtySumKg) return b.wbQtySumKg - a.wbQtySumKg;
  if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
  if (b.dailyDeliverablesLen !== a.dailyDeliverablesLen) {
    return b.dailyDeliverablesLen - a.dailyDeliverablesLen;
  }
  if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
  return b.id.localeCompare(a.id);
}

export function pickTruckingWbCompleteKeeper<T extends TruckingWbKeeperScore>(rows: T[]): T {
  return [...rows].sort(compareTruckingWbCompleteKeepers)[0];
}
