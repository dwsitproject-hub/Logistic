import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  hasCompleteSapVesselIdentity,
  parseContractSapClosedFlag,
  resolveShipmentDisplayVesselName,
} from '../utils/sapVesselFields';
import { resolveStoGroupShipmentIds } from '../utils/shipmentStoGroupMembersSql';
import { ensureMasterVesselFromSap } from './masterVesselFromSap.service';
import { resolveMasterVessel } from './resolveMasterVessel.service';

type ShipmentVesselRow = Record<string, unknown>;

function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/** Queued or running backfill keys — one entry per (shipment, vessel code). */
const backfillInFlight = new Set<string>();
const backfillQueue: { dedupeKey: string; run: () => Promise<void> }[] = [];
let backfillActive = 0;

/*
 * A shipments page can need a backfill for hundreds of rows at once. Firing them all
 * immediately took every client in the pg pool (max 20), so the request's own queries
 * failed with "timeout exceeded when trying to connect". Drain them a few at a time
 * instead: same work, same order, bounded pressure on the pool and on the DB CPU.
 */
const BACKFILL_MAX_CONCURRENT = 4;

function pumpBackfillQueue(): void {
  while (backfillActive < BACKFILL_MAX_CONCURRENT) {
    const next = backfillQueue.shift();
    if (!next) return;
    backfillActive += 1;
    void next.run().finally(() => {
      backfillActive -= 1;
      backfillInFlight.delete(next.dedupeKey);
      pumpBackfillQueue();
    });
  }
}

/**
 * Attach SAP / master vessel identity without dropping source fields.
 * Display overlay (list): Open + KLIP filled → KLIP; GR Close → Master/SAP first.
 */
export function mergeShipmentVesselFromSapRow(
  row: ShipmentVesselRow,
  options?: { overlayDisplayName?: boolean },
): boolean {
  const sapName = trimOrNull(row.vessel_name_sap);
  const sapCode = trimOrNull(row.vessel_code_sap);
  const sapOwner = trimOrNull(row.vessel_owner_sap);
  const masterName = trimOrNull(row.vessel_name_master);
  const klipName = trimOrNull(row.vessel_name);
  row.vessel_name_klip = klipName;
  if (sapName) row.vessel_name_sap = sapName;
  if (masterName) row.vessel_name_master = masterName;

  const overlay = options?.overlayDisplayName !== false;
  if (overlay) {
    const displayName = resolveShipmentDisplayVesselName(masterName, sapName, klipName, {
      contractSapClosed: parseContractSapClosedFlag(row.is_contract_sap_closed),
    });
    if (displayName) row.vessel_name = displayName;
  }

  if (sapCode && !trimOrNull(row.vessel_code)) row.vessel_code = sapCode;
  if (sapOwner && !trimOrNull(row.vessel_owner)) row.vessel_owner = sapOwner;

  return hasCompleteSapVesselIdentity({
    vessel_code: sapCode,
    vessel_name: sapName,
    vessel_owner: sapOwner,
  });
}

/** Persist SAP vessel onto shipments + master_vessels (page-scoped, fire-and-forget). */
export function queueShipmentVesselSapBackfill(row: ShipmentVesselRow): void {
  const vesselCode = trimOrNull(row.vessel_code);
  const vesselName = trimOrNull(row.vessel_name);
  if (!hasCompleteSapVesselIdentity({
    vessel_code: vesselCode,
    vessel_name: vesselName,
    vessel_owner: trimOrNull(row.vessel_owner),
  })) {
    return;
  }

  const shipmentId = trimOrNull(row.id);
  const dedupeKey = `${shipmentId ?? trimOrNull(row.sto_key) ?? 'sto'}:${vesselCode}`;
  if (backfillInFlight.has(dedupeKey)) return;
  backfillInFlight.add(dedupeKey);

  const run = async (): Promise<void> => {
    try {
      await ensureMasterVesselFromSap({
        vessel_code: vesselCode,
        vessel_name: vesselName,
        vessel_owner: trimOrNull(row.vessel_owner),
      });

      const resolved = await resolveMasterVessel({
        vessel_code: vesselCode,
        vessel_name: vesselName,
        vessel_owner: trimOrNull(row.vessel_owner),
        source: 'sap_import',
        updateAttributes: false,
      });

      const masterVesselId = resolved?.master_vessel_id ?? null;

      const stoKey = trimOrNull(row.sto_key);
      if (stoKey) {
        await query(
          `WITH latest_spd_contract AS (
             SELECT DISTINCT ON (spd.contract_number)
               spd.contract_number,
               NULLIF(TRIM(COALESCE(
                 spd.sto_number::text,
                 spd.data->'raw'->>'STO No.',
                 spd.data->'raw'->>'STO Number',
                 spd.data->'shipment'->>'sto_no',
                 spd.data->'contract'->>'sto_no'
               )), '') AS effective_sto
             FROM sap_processed_data spd
             WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
             ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
           )
           UPDATE shipments s SET
            vessel_code = COALESCE(NULLIF(TRIM(s.vessel_code), ''), $2),
            vessel_name = COALESCE(NULLIF(TRIM(s.vessel_name), ''), $3),
            vessel_owner = COALESCE(NULLIF(TRIM(s.vessel_owner), ''), $4),
            master_vessel_id = COALESCE($5, s.master_vessel_id),
            updated_at = CURRENT_TIMESTAMP
          FROM contracts c
          LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
          WHERE s.contract_id = c.id
            AND TRIM(COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id::text)) = TRIM($1::text)
            AND (
              s.vessel_code IS NULL OR TRIM(s.vessel_code) = ''
              OR s.vessel_name IS NULL OR TRIM(s.vessel_name) = ''
              OR ($5 IS NOT NULL AND s.master_vessel_id IS NULL)
            )`,
          [stoKey, vesselCode, vesselName, trimOrNull(row.vessel_owner), masterVesselId],
        );
      } else if (shipmentId) {
        await query(
          `UPDATE shipments SET
            vessel_code = COALESCE(NULLIF(TRIM(vessel_code), ''), $2),
            vessel_name = COALESCE(NULLIF(TRIM(vessel_name), ''), $3),
            vessel_owner = COALESCE(NULLIF(TRIM(vessel_owner), ''), $4),
            master_vessel_id = COALESCE($5, master_vessel_id),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::uuid
            AND (
              vessel_code IS NULL OR TRIM(vessel_code) = ''
              OR vessel_name IS NULL OR TRIM(vessel_name) = ''
              OR ($5 IS NOT NULL AND master_vessel_id IS NULL)
            )`,
          [shipmentId, vesselCode, vesselName, trimOrNull(row.vessel_owner), masterVesselId],
        );
      }
    } catch (error) {
      logger.warn('queueShipmentVesselSapBackfill failed', { dedupeKey, error });
    }
  };

  backfillQueue.push({ dedupeKey, run });
  pumpBackfillQueue();
}

export interface ShipmentVesselIdentityFanOut {
  vessel_name: string | null;
  vessel_code: string | null;
  vessel_owner: string | null;
  vessel_capacity: unknown;
  vessel_hull_type: string | null;
  charter_type: string | null;
  master_vessel_id: string | null;
}

const VESSEL_IDENTITY_KEYS = [
  'vessel_name',
  'vessel_code',
  'vessel_owner',
  'vessel_capacity',
  'vessel_hull_type',
  'charter_type',
  'master_vessel_id',
] as const;

/** True when Edit Shipment sent any voyage-level vessel identity field. */
export function hasVesselIdentityUpdate(updateData: Record<string, unknown>): boolean {
  return VESSEL_IDENTITY_KEYS.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(updateData, key)) return false;
    const value = updateData[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
  });
}

/**
 * Same rule as ATA/ETA: vessel identity is voyage-level. Persist onto every SEA
 * shipment PO in the STO group (including the row the user saved).
 */
export async function fanOutVesselIdentityToStoGroup(
  anchorShipmentId: string,
  vessel: ShipmentVesselIdentityFanOut,
): Promise<number> {
  const memberIds = await resolveStoGroupShipmentIds(anchorShipmentId);
  const ids = memberIds.length > 0 ? memberIds : [anchorShipmentId];

  const result = await query(
    `UPDATE shipments SET
       vessel_name = $1,
       vessel_code = $2,
       vessel_owner = $3,
       vessel_capacity = $4::numeric,
       vessel_hull_type = $5,
       charter_type = $6,
       master_vessel_id = $7::uuid,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ANY($8::uuid[])`,
    [
      vessel.vessel_name,
      vessel.vessel_code,
      vessel.vessel_owner,
      vessel.vessel_capacity ?? null,
      vessel.vessel_hull_type,
      vessel.charter_type,
      vessel.master_vessel_id,
      ids,
    ],
  );

  const touched = result.rowCount ?? 0;
  if (ids.length > 1) {
    logger.info('Fanned vessel identity out to STO group shipment POs', {
      anchorShipmentId,
      memberCount: ids.length,
      rowsTouched: touched,
    });
  }
  return touched;
}
