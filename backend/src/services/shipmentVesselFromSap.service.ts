import { query } from '../database/connection';
import logger from '../utils/logger';
import { hasCompleteSapVesselIdentity, resolveShipmentDisplayVesselName } from '../utils/sapVesselFields';
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
 * When shipment row lacks vessel but SAP has both code + name, expose SAP values on the row.
 * Display vessel name: Master Vessel KLIP name first, then SAP, then stored shipment input.
 * Returns true when SAP has a complete vessel identity (code + name) for optional DB backfill.
 */
export function mergeShipmentVesselFromSapRow(row: ShipmentVesselRow): boolean {
  const sapName = trimOrNull(row.vessel_name_sap);
  const sapCode = trimOrNull(row.vessel_code_sap);
  const sapOwner = trimOrNull(row.vessel_owner_sap);
  const masterName = trimOrNull(row.vessel_name_master);
  const klipName = trimOrNull(row.vessel_name);
  delete (row as { vessel_name_sap?: unknown }).vessel_name_sap;
  delete (row as { vessel_code_sap?: unknown }).vessel_code_sap;
  delete (row as { vessel_owner_sap?: unknown }).vessel_owner_sap;
  delete (row as { vessel_name_master?: unknown }).vessel_name_master;

  const displayName = resolveShipmentDisplayVesselName(masterName, sapName, klipName);
  if (displayName) row.vessel_name = displayName;

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
