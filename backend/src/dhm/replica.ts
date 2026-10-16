import { query } from '../database/connection';
import { normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { fromDhmVesselData } from './mapper';
import { shouldApplyDhmRecord, type DhmApplyOptions } from './versionGuard';
import type { DhmRecord } from './types';

/** Inbound 201 often returns `code` on the envelope while `record.data` is empty. */
export function resolveDhmReplicaCode(
  record: DhmRecord,
  envelopeCode?: string | null,
): string | null {
  const fromData = fromDhmVesselData(record.data).dhm_code;
  const fromEnvelope = String(envelopeCode || '').trim();
  return fromData || fromEnvelope || null;
}

export async function persistDhmReplica(
  masterVesselId: string,
  record: DhmRecord,
  envelopeCode?: string | null,
): Promise<void> {
  const code = resolveDhmReplicaCode(record, envelopeCode);
  const payload = { ...(record.data ?? {}) };
  if (code && payload.code == null) payload.code = code;
  const dhmId = String(record.id || '').trim() || null;
  await query(
    `UPDATE master_vessels
     SET dhm_id = COALESCE($2::uuid, dhm_id),
         dhm_code = COALESCE($3, dhm_code),
         dhm_version = COALESCE($4, dhm_version),
         dhm_updated_at = COALESCE($5::timestamptz, dhm_updated_at),
         dhm_is_deleted = $6,
         dhm_payload = $7::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      masterVesselId,
      dhmId,
      code,
      record.version || null,
      record.updatedAt || null,
      record.isDeleted,
      JSON.stringify(payload),
    ],
  );
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
export async function applyDhmVesselRecord(
  record: DhmRecord,
  options: DhmApplyOptions = {},
): Promise<{ id: string; created: boolean; skipped?: 'stale' | 'deleted' | 'unlinked' }> {
  // A vessel DHM delivered at an older version than the replica holds is left alone (see versionGuard.ts).
  if (!(await shouldApplyDhmRecord('vessel', record, options))) {
    const known = await query(`SELECT id FROM master_vessels WHERE dhm_id = $1::uuid LIMIT 1`, [record.id]);
    return { id: String(known.rows[0]?.id ?? ''), created: false, skipped: 'stale' };
  }
  // A DHM tombstone only marks the link. KLIP is the vessel source (Ryan, 2026-10-15): when DHM soft-deleted its whole vessel
  // catalog, the pull handed back every record with its OLD name, which renamed vessels the vessel sheet had just loaded
  // (MED PACIFIC -> BG. PACIFIC STAR 3) and would re-insert archived ones. So a tombstone finds its row by dhm_id only (a
  // match by code or name could hit another vessel), never writes the name or attributes, and never creates a row.
  if (record.isDeleted) {
    const marked = await query(
      `UPDATE master_vessels
          SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), dhm_updated_at = COALESCE($3::timestamptz, dhm_updated_at),
              updated_at = CURRENT_TIMESTAMP
        WHERE dhm_id = $1::uuid
        RETURNING id`,
      [record.id, record.version ?? null, record.updatedAt || null],
    );
    return { id: String(marked.rows[0]?.id ?? ''), created: false, skipped: 'deleted' };
  }
  // A live record only refreshes the link too (Ryan, 2026-10-16). The pull used to match a DHM record by SAP code or name and
  // overwrite that KLIP vessel with DHM's name and attributes, or insert DHM's copy: after DHM renumbered its codes it shifted
  // 61 SIT names alphabetically (BG. ANAK LAUT 289 became BG. AGENA) and inserted 79 duplicates of sheet vessels in two minutes.
  // KLIP pushes every vessel and the push writes the link, so the pull touches only the row it knows by dhm_id (or dhm_code),
  // writes only the dhm_* fields, and leaves a vessel only DHM has out of KLIP.
  const dhmCode = fromDhmVesselData(record.data).dhm_code || null;
  const linked = await query(
    `UPDATE master_vessels mv
        SET dhm_id = $1::uuid,
            dhm_code = CASE WHEN $2::text IS NULL OR EXISTS (SELECT 1 FROM master_vessels o WHERE o.dhm_code = $2 AND o.id <> mv.id)
                            THEN mv.dhm_code ELSE $2 END,
            dhm_version = $3, dhm_updated_at = $4::timestamptz, dhm_is_deleted = false, dhm_payload = $5::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE mv.id = (SELECT id FROM master_vessels
                      WHERE dhm_id = $1::uuid OR ($2::text IS NOT NULL AND dhm_code = $2)
                      ORDER BY (dhm_id = $1::uuid) DESC NULLS LAST LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM master_vessels o WHERE o.dhm_id = $1::uuid AND o.id <> mv.id)
      RETURNING mv.id`,
    [record.id, dhmCode, record.version, record.updatedAt || null, JSON.stringify(record.data ?? {})],
  );
  if (!linked.rows[0]?.id) return { id: '', created: false, skipped: 'unlinked' };
  return { id: String(linked.rows[0].id), created: false };
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
