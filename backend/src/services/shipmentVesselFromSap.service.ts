import { query } from '../database/connection';
import logger from '../utils/logger';
import { hasCompleteSapVesselIdentity } from '../utils/sapVesselFields';
import { ensureMasterVesselFromSap } from './masterVesselFromSap.service';

type ShipmentVesselRow = Record<string, unknown>;

function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

const backfillInFlight = new Set<string>();

/**
 * When shipment row lacks vessel but SAP has both code + name, expose SAP values on the row.
 * Returns true when a complete SAP vessel identity was applied.
 */
export function mergeShipmentVesselFromSapRow(row: ShipmentVesselRow): boolean {
  const sapName = trimOrNull(row.vessel_name_sap);
  const sapCode = trimOrNull(row.vessel_code_sap);
  const sapOwner = trimOrNull(row.vessel_owner_sap);
  delete (row as { vessel_name_sap?: unknown }).vessel_name_sap;
  delete (row as { vessel_code_sap?: unknown }).vessel_code_sap;
  delete (row as { vessel_owner_sap?: unknown }).vessel_owner_sap;

  if (!hasCompleteSapVesselIdentity({ vessel_code: sapCode, vessel_name: sapName, vessel_owner: sapOwner })) {
    return false;
  }

  if (!trimOrNull(row.vessel_name)) row.vessel_name = sapName;
  if (!trimOrNull(row.vessel_code)) row.vessel_code = sapCode;
  if (!trimOrNull(row.vessel_owner) && sapOwner) row.vessel_owner = sapOwner;
  return true;
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

  void (async () => {
    try {
      await ensureMasterVesselFromSap({
        vessel_code: vesselCode,
        vessel_name: vesselName,
        vessel_owner: trimOrNull(row.vessel_owner),
      });

      const stoKey = trimOrNull(row.sto_key);
      if (stoKey) {
        await query(
          `UPDATE shipments s SET
            vessel_code = COALESCE(NULLIF(TRIM(s.vessel_code), ''), $2),
            vessel_name = COALESCE(NULLIF(TRIM(s.vessel_name), ''), $3),
            vessel_owner = COALESCE(NULLIF(TRIM(s.vessel_owner), ''), $4),
            updated_at = CURRENT_TIMESTAMP
          FROM contracts c
          WHERE s.contract_id = c.id
            AND TRIM(COALESCE(c.sto_number::text, '')) = $1
            AND (
              s.vessel_code IS NULL OR TRIM(s.vessel_code) = ''
              OR s.vessel_name IS NULL OR TRIM(s.vessel_name) = ''
            )`,
          [stoKey, vesselCode, vesselName, trimOrNull(row.vessel_owner)],
        );
      } else if (shipmentId) {
        await query(
          `UPDATE shipments SET
            vessel_code = COALESCE(NULLIF(TRIM(vessel_code), ''), $2),
            vessel_name = COALESCE(NULLIF(TRIM(vessel_name), ''), $3),
            vessel_owner = COALESCE(NULLIF(TRIM(vessel_owner), ''), $4),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::uuid
            AND (
              vessel_code IS NULL OR TRIM(vessel_code) = ''
              OR vessel_name IS NULL OR TRIM(vessel_name) = ''
            )`,
          [shipmentId, vesselCode, vesselName, trimOrNull(row.vessel_owner)],
        );
      }
    } catch (error) {
      logger.warn('queueShipmentVesselSapBackfill failed', { dedupeKey, error });
    } finally {
      backfillInFlight.delete(dedupeKey);
    }
  })();
}
