import { sqlRealizationEndDate, sqlRealizationStartDate } from './truckingRealizationSql';
import { isContractDeliveryClosed, sqlIsContractSapClosedExpr } from './contractDeliveryStatus';

export type TruckingEffectiveStatus =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

/** KLIP user planning from Add New Trucking (daily deliverables with date + qty). */
export function sqlHasTruckingKlipPlanning(truckingAlias = 't'): string {
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(${truckingAlias}.daily_deliverables, '[]'::jsonb)) AS dd(elem)
    WHERE NULLIF(TRIM(dd.elem->>'date'), '') IS NOT NULL
      AND COALESCE(NULLIF(TRIM(dd.elem->>'quantity_delivered'), '')::numeric, 0) > 0
  )`;
}

export function hasTruckingKlipPlanning(dailyDeliverables: unknown): boolean {
  if (!Array.isArray(dailyDeliverables) || dailyDeliverables.length === 0) return false;
  return dailyDeliverables.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? '').trim();
    const qty = Number(r.quantity_delivered ?? 0);
    return date.length > 0 && Number.isFinite(qty) && qty > 0;
  });
}

export function hasTruckingSto(stoNumber: unknown): boolean {
  return String(stoNumber ?? '').trim().length > 0;
}

/**
 * Effective status: IN_PROGRESS / COMPLETED from realization layer only (extension + SAP).
 * PLANNED / UNPLANNED from KLIP planning; open SAP without planning → UNPLANNED (STO not required).
 */
export function sqlTruckingEffectiveStatus(
  contractAlias = 'c',
  _stoExpr?: string,
): string {
  return `CASE
    WHEN COALESCE(t.status, '') = 'CANCELLED' THEN 'CANCELLED'
    WHEN ${sqlIsContractSapClosedExpr(contractAlias)} THEN 'COMPLETED'
    WHEN ${sqlRealizationEndDate(contractAlias)} IS NOT NULL THEN 'COMPLETED'
    WHEN ${sqlRealizationStartDate(contractAlias)} IS NOT NULL THEN 'IN_PROGRESS'
    WHEN ${sqlHasTruckingKlipPlanning('t')} THEN 'PLANNED'
    WHEN NOT (${sqlIsContractSapClosedExpr(contractAlias)}) THEN 'UNPLANNED'
    ELSE 'COMPLETED'
  END`;
}

export function deriveTruckingEffectiveStatus(
  dbStatus: unknown,
  realizationStartDate: unknown,
  realizationEndDate: unknown,
  options?: {
    dailyDeliverables?: unknown;
    stoNumber?: unknown;
    contractImportStatus?: unknown;
  },
): TruckingEffectiveStatus {
  const status = String(dbStatus ?? '').trim().toUpperCase();
  if (status === 'CANCELLED') return 'CANCELLED';
  if (isContractDeliveryClosed(options?.contractImportStatus)) return 'COMPLETED';
  if (hasDateValue(realizationEndDate)) return 'COMPLETED';
  if (hasDateValue(realizationStartDate)) return 'IN_PROGRESS';
  if (hasTruckingKlipPlanning(options?.dailyDeliverables)) return 'PLANNED';
  if (!isContractDeliveryClosed(options?.contractImportStatus)) return 'UNPLANNED';
  return 'COMPLETED';
}

function hasDateValue(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

/** Sync realization extension from SAP receive columns; does not modify planning dates on trucking_operations. */
export const SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP = `
  WITH latest_sap AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')))
      spd.contract_number,
      spd.sto_number,
      COALESCE(
        spd.data->'raw'->>'Trucking Last Receive Date',
        spd.data->>'Trucking Last Receive Date',
        spd.data->'trucking'->0->'data'->>'trucking_last_receive_date'
      ) AS last_receive_raw,
      COALESCE(
        spd.data->'raw'->>'Trucking Start Receive Date',
        spd.data->>'Trucking Start Receive Date',
        spd.data->'trucking'->0->'data'->>'trucking_start_receive_date'
      ) AS start_receive_raw
    FROM sap_processed_data spd
    WHERE COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')) IS NOT NULL
    ORDER BY COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')),
      spd.created_at DESC NULLS LAST
  ),
  parsed AS (
    SELECT
      contract_number,
      sto_number,
      CASE
        WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
        WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
        WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
        WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YYYY')
        ELSE NULL
      END AS last_receive_date,
      CASE
        WHEN start_receive_raw IS NULL OR length(trim(start_receive_raw)) < 6 THEN NULL
        WHEN trim(start_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(start_receive_raw)::date
        WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YY')
        WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YYYY')
        ELSE NULL
      END AS start_receive_date
    FROM latest_sap
  ),
  upserted AS (
    INSERT INTO trucking_realizations (
      trucking_operation_id,
      realization_start_date,
      realization_end_date,
      source,
      sap_synced_at
    )
    SELECT
      t.id,
      p.start_receive_date,
      p.last_receive_date,
      'sap',
      CURRENT_TIMESTAMP
    FROM trucking_operations t
    INNER JOIN contracts c ON t.contract_id = c.id
    INNER JOIN parsed p ON (
      p.contract_number = c.contract_id
      OR (
        NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
        AND p.sto_number = NULLIF(TRIM(c.sto_number::text), '')
      )
    )
    WHERE (p.start_receive_date IS NOT NULL OR p.last_receive_date IS NOT NULL)
    ON CONFLICT (trucking_operation_id) DO UPDATE SET
      realization_start_date = COALESCE(trucking_realizations.realization_start_date, EXCLUDED.realization_start_date),
      realization_end_date = COALESCE(trucking_realizations.realization_end_date, EXCLUDED.realization_end_date),
      source = CASE
        WHEN trucking_realizations.realization_start_date IS NULL
          AND trucking_realizations.realization_end_date IS NULL
        THEN EXCLUDED.source
        ELSE trucking_realizations.source
      END,
      sap_synced_at = COALESCE(trucking_realizations.sap_synced_at, EXCLUDED.sap_synced_at),
      updated_at = CURRENT_TIMESTAMP
    RETURNING trucking_operation_id, realization_start_date, realization_end_date
  )
  UPDATE trucking_operations t
  SET
    status = CASE
      WHEN t.status = 'CANCELLED' THEN t.status
      WHEN ${sqlIsContractSapClosedExpr('c')} THEN 'COMPLETED'
      WHEN u.realization_end_date IS NOT NULL THEN 'COMPLETED'
      WHEN u.realization_start_date IS NOT NULL THEN 'IN_PROGRESS'
      ELSE COALESCE(t.status, 'PLANNED')
    END,
    updated_at = CURRENT_TIMESTAMP
  FROM upserted u
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE t.id = u.trucking_operation_id
    AND t.status <> 'CANCELLED'
`;
