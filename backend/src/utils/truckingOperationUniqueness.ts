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
       AND COALESCE(t.status, '') <> 'CANCELLED'
     ORDER BY t.created_at ASC, t.id ASC`,
    [contractUuid],
  );
  return result.rows as ActiveTruckingOpRow[];
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
  COALESCE(jsonb_array_length(t.daily_deliverables), 0) DESC,
  t.updated_at DESC NULLS LAST,
  t.created_at DESC,
  t.id DESC
`.trim();
