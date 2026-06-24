import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../database/connection';
import {
  SHIPMENT_ATA_API_FIELDS,
  SHIPMENT_ATA_API_TO_DB,
  type ShipmentAtaApiField,
  type ShipmentAtaOverridePayload,
} from '../utils/shipmentAtaOverrideFields';

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
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export type ShipmentAtaOverrideRow = {
  id: string;
  shipment_id: string;
  ata_arrival: string | null;
  ata_berthed: string | null;
  ata_loading_start: string | null;
  ata_loading_complete: string | null;
  ata_sailed: string | null;
  ata_discharge_arrival: string | null;
  ata_discharge_berthed: string | null;
  ata_discharge_start: string | null;
  ata_discharge_complete: string | null;
  source: string;
  updated_by: string | null;
};

const EMPTY_ROW = (shipmentId: string, userId?: string | null): ShipmentAtaOverrideRow => ({
  id: '',
  shipment_id: shipmentId,
  ata_arrival: null,
  ata_berthed: null,
  ata_loading_start: null,
  ata_loading_complete: null,
  ata_sailed: null,
  ata_discharge_arrival: null,
  ata_discharge_berthed: null,
  ata_discharge_start: null,
  ata_discharge_complete: null,
  source: 'manual',
  updated_by: userId ?? null,
});

export async function getShipmentAtaOverrideByShipmentId(
  shipmentId: string,
): Promise<ShipmentAtaOverrideRow | null> {
  const result = await query(
    `SELECT id, shipment_id,
            ata_arrival::text, ata_berthed::text, ata_loading_start::text, ata_loading_complete::text,
            ata_sailed::text, ata_discharge_arrival::text, ata_discharge_berthed::text,
            ata_discharge_start::text, ata_discharge_complete::text,
            source, updated_by::text
     FROM shipment_ata_overrides
     WHERE shipment_id = $1::uuid
     LIMIT 1`,
    [shipmentId],
  );
  return (result.rows[0] as ShipmentAtaOverrideRow | undefined) ?? null;
}

export function mapOverrideRowToApi(row: ShipmentAtaOverrideRow | null): ShipmentAtaOverridePayload {
  if (!row) return {};
  const out: ShipmentAtaOverridePayload = {};
  for (const apiField of SHIPMENT_ATA_API_FIELDS) {
    const dbCol = SHIPMENT_ATA_API_TO_DB[apiField];
    const val = (row as Record<string, unknown>)[dbCol];
    if (val != null && String(val).trim() !== '') {
      out[apiField] = String(val).slice(0, 10);
    }
  }
  return out;
}

export async function upsertShipmentAtaOverride(
  executor: Queryable,
  shipmentId: string,
  input: ShipmentAtaOverridePayload,
  userId?: string | null,
): Promise<ShipmentAtaOverrideRow | null> {
  const existing = await getShipmentAtaOverrideByShipmentId(shipmentId);
  const merged: Record<string, string | null> = {
    ata_arrival: existing?.ata_arrival ?? null,
    ata_berthed: existing?.ata_berthed ?? null,
    ata_loading_start: existing?.ata_loading_start ?? null,
    ata_loading_complete: existing?.ata_loading_complete ?? null,
    ata_sailed: existing?.ata_sailed ?? null,
    ata_discharge_arrival: existing?.ata_discharge_arrival ?? null,
    ata_discharge_berthed: existing?.ata_discharge_berthed ?? null,
    ata_discharge_start: existing?.ata_discharge_start ?? null,
    ata_discharge_complete: existing?.ata_discharge_complete ?? null,
  };

  let touched = false;
  for (const apiField of SHIPMENT_ATA_API_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, apiField)) continue;
    touched = true;
    merged[SHIPMENT_ATA_API_TO_DB[apiField]] = toDateOrNull(input[apiField as ShipmentAtaApiField]);
  }

  if (!touched) {
    return existing;
  }

  const hasAnyValue = Object.values(merged).some((v) => v != null);
  if (!hasAnyValue) {
    await runQuery(executor, `DELETE FROM shipment_ata_overrides WHERE shipment_id = $1::uuid`, [shipmentId]);
    return null;
  }

  const result = await runQuery<ShipmentAtaOverrideRow>(
    executor,
    `INSERT INTO shipment_ata_overrides (
       shipment_id,
       ata_arrival,
       ata_berthed,
       ata_loading_start,
       ata_loading_complete,
       ata_sailed,
       ata_discharge_arrival,
       ata_discharge_berthed,
       ata_discharge_start,
       ata_discharge_complete,
       source,
       updated_by
     ) VALUES (
       $1::uuid, $2::date, $3::date, $4::date, $5::date, $6::date,
       $7::date, $8::date, $9::date, $10::date, 'manual', $11::uuid
     )
     ON CONFLICT (shipment_id) DO UPDATE SET
       ata_arrival = EXCLUDED.ata_arrival,
       ata_berthed = EXCLUDED.ata_berthed,
       ata_loading_start = EXCLUDED.ata_loading_start,
       ata_loading_complete = EXCLUDED.ata_loading_complete,
       ata_sailed = EXCLUDED.ata_sailed,
       ata_discharge_arrival = EXCLUDED.ata_discharge_arrival,
       ata_discharge_berthed = EXCLUDED.ata_discharge_berthed,
       ata_discharge_start = EXCLUDED.ata_discharge_start,
       ata_discharge_complete = EXCLUDED.ata_discharge_complete,
       source = 'manual',
       updated_by = COALESCE(EXCLUDED.updated_by, shipment_ata_overrides.updated_by),
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, shipment_id,
       ata_arrival::text, ata_berthed::text, ata_loading_start::text, ata_loading_complete::text,
       ata_sailed::text, ata_discharge_arrival::text, ata_discharge_berthed::text,
       ata_discharge_start::text, ata_discharge_complete::text,
       source, updated_by::text`,
    [
      shipmentId,
      merged.ata_arrival,
      merged.ata_berthed,
      merged.ata_loading_start,
      merged.ata_loading_complete,
      merged.ata_sailed,
      merged.ata_discharge_arrival,
      merged.ata_discharge_berthed,
      merged.ata_discharge_start,
      merged.ata_discharge_complete,
      userId ?? null,
    ],
  );

  return result.rows[0] ?? EMPTY_ROW(shipmentId, userId);
}
