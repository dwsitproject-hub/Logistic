import { query } from '../database/connection';
import { normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { fromDhmVesselData } from './mapper';
import type { DhmRecord } from './types';

export async function persistDhmReplica(masterVesselId: string, record: DhmRecord): Promise<void> {
  const mapped = fromDhmVesselData(record.data);
  await query(
    `UPDATE master_vessels
     SET dhm_id = $2::uuid,
         dhm_code = $3,
         dhm_version = $4,
         dhm_updated_at = $5::timestamptz,
         dhm_is_deleted = $6,
         dhm_payload = $7::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      masterVesselId,
      record.id,
      mapped.dhm_code || dhmCodeFromRecord(record),
      record.version,
      record.updatedAt || null,
      record.isDeleted,
      JSON.stringify(record.data ?? {}),
    ],
  );
}

function dhmCodeFromRecord(record: DhmRecord): string | null {
  return fromDhmVesselData(record.data).dhm_code;
}

async function findLocalVesselId(record: DhmRecord): Promise<string | null> {
  const mapped = fromDhmVesselData(record.data);
  const byId = await query(`SELECT id FROM master_vessels WHERE dhm_id = $1 LIMIT 1`, [record.id]);
  if (byId.rows[0]?.id) return String(byId.rows[0].id);

  const code = mapped.dhm_code;
  if (code) {
    const byDhmCode = await query(`SELECT id FROM master_vessels WHERE dhm_code = $1 LIMIT 1`, [code]);
    if (byDhmCode.rows[0]?.id) return String(byDhmCode.rows[0].id);
  }

  const sap = uppercaseText(mapped.vessel_code_sap);
  if (sap) {
    const bySap = await query(
      `SELECT id FROM master_vessels WHERE upper(trim(vessel_code)) = $1 LIMIT 1`,
      [sap],
    );
    if (bySap.rows[0]?.id) return String(bySap.rows[0].id);
  }

  const norm = mapped.vessel_name ? normalizeVesselName(mapped.vessel_name) : '';
  if (norm) {
    const byName = await query(
      `SELECT id FROM master_vessels
       WHERE normalized_vessel_name = $1 AND code_status = 'OFFICIAL'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [norm],
    );
    if (byName.rows[0]?.id) return String(byName.rows[0].id);
  }
  return null;
}

/** Upsert replica from a DHM vessel record. Does not delete shipment-linked KLIP rows. */
export async function applyDhmVesselRecord(record: DhmRecord): Promise<{ id: string; created: boolean }> {
  const mapped = fromDhmVesselData(record.data);
  const existingId = await findLocalVesselId(record);
  const vesselName = uppercaseText(mapped.vessel_name) || 'UNKNOWN VESSEL';
  const norm = normalizeVesselName(vesselName);
  const sapCode = uppercaseText(mapped.vessel_code_sap);
  const dhmCode = mapped.dhm_code || null;
  const vesselCode = sapCode || dhmCode || `VSL-UNKNOWN`;
  const codeStatus = sapCode ? 'OFFICIAL' : 'OFFICIAL';

  if (existingId) {
    await query(
      `UPDATE master_vessels
       SET vessel_name = COALESCE($2, vessel_name),
           normalized_vessel_name = COALESCE($3, normalized_vessel_name),
           vessel_capacity_mt = COALESCE($4, vessel_capacity_mt),
           heating = COALESCE($5, heating),
           vessel_type = COALESCE($6, vessel_type),
           lambung_type = COALESCE($7, lambung_type),
           terms = COALESCE($8, terms),
           dhm_id = $9::uuid,
           dhm_code = $10,
           dhm_version = $11,
           dhm_updated_at = $12::timestamptz,
           dhm_is_deleted = $13,
           dhm_payload = $14::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        existingId,
        vesselName,
        norm,
        mapped.vessel_capacity_mt,
        mapped.heating,
        mapped.vessel_type,
        mapped.lambung_type,
        mapped.terms,
        record.id,
        dhmCode,
        record.version,
        record.updatedAt || null,
        record.isDeleted,
        JSON.stringify(record.data ?? {}),
      ],
    );
    return { id: existingId, created: false };
  }

  const inserted = await query(
    `INSERT INTO master_vessels (
       vessel_code, vessel_name, normalized_vessel_name, vessel_capacity_mt,
       heating, vessel_type, lambung_type, terms, code_status,
       dhm_id, dhm_code, dhm_version, dhm_updated_at, dhm_is_deleted, dhm_payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::uuid, $11, $12, $13::timestamptz, $14, $15::jsonb
     )
     ON CONFLICT (vessel_code) DO UPDATE SET
       vessel_name = COALESCE(EXCLUDED.vessel_name, master_vessels.vessel_name),
       normalized_vessel_name = COALESCE(EXCLUDED.normalized_vessel_name, master_vessels.normalized_vessel_name),
       dhm_id = EXCLUDED.dhm_id,
       dhm_code = EXCLUDED.dhm_code,
       dhm_version = EXCLUDED.dhm_version,
       dhm_updated_at = EXCLUDED.dhm_updated_at,
       dhm_is_deleted = EXCLUDED.dhm_is_deleted,
       dhm_payload = EXCLUDED.dhm_payload,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      vesselCode,
      vesselName,
      norm,
      mapped.vessel_capacity_mt,
      mapped.heating,
      mapped.vessel_type,
      mapped.lambung_type,
      mapped.terms,
      codeStatus,
      record.id,
      dhmCode,
      record.version,
      record.updatedAt || null,
      record.isDeleted,
      JSON.stringify(record.data ?? {}),
    ],
  );
  return { id: String(inserted.rows[0].id), created: true };
}

export async function markDhmWebhookDelivery(deliveryId: string): Promise<boolean> {
  const result = await query(
    `INSERT INTO dhm_webhook_deliveries (delivery_id)
     VALUES ($1)
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING delivery_id`,
    [deliveryId],
  );
  return result.rows.length > 0;
}

export async function getDhmSyncCursor(entity: string): Promise<string | null> {
  const result = await query(
    `SELECT cursor FROM dhm_sync_state WHERE entity = $1`,
    [entity],
  );
  return result.rows[0]?.cursor ? String(result.rows[0].cursor) : null;
}

export async function saveDhmSyncCursor(entity: string, cursor: string | null, updatedAt?: string | null): Promise<void> {
  await query(
    `INSERT INTO dhm_sync_state (entity, cursor, last_updated_at, updated_at)
     VALUES ($1, $2, $3::timestamptz, CURRENT_TIMESTAMP)
     ON CONFLICT (entity) DO UPDATE SET
       cursor = EXCLUDED.cursor,
       last_updated_at = COALESCE(EXCLUDED.last_updated_at, dhm_sync_state.last_updated_at),
       updated_at = CURRENT_TIMESTAMP`,
    [entity, cursor, updatedAt || null],
  );
}

export { findLocalVesselId };
