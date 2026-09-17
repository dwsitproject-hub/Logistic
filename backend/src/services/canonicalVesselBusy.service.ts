import { query } from '../database/connection';
import { sqlResolveMasterVesselIdFromShipment } from '../utils/masterVesselCanonicalSql';
import { resolveMasterVessel } from './resolveMasterVessel.service';

/** Returns true when the canonical vessel already has an active planned/ongoing shipment. */
export async function findCanonicalVesselBusyConflict(
  input: { vessel_code?: string | null; vessel_name?: string | null },
  excludeShipmentId?: string | null,
): Promise<{
  master_vessel_id: string;
  vessel_name: string;
  conflicting_shipment_id: string;
} | null> {
  const resolved = await resolveMasterVessel({
    vessel_code: input.vessel_code,
    vessel_name: input.vessel_name,
    source: 'manual',
    updateAttributes: false,
  });
  if (!resolved) return null;

  const masterId = resolved.master_vessel_id;
  const params: unknown[] = [masterId];
  let excludeClause = '';
  if (excludeShipmentId) {
    params.push(excludeShipmentId);
    excludeClause = `AND s.id <> $${params.length}::uuid`;
  }

  const resolveExpr = sqlResolveMasterVesselIdFromShipment('s');

  const result = await query(
    `WITH latest_spd AS (
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
       WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) <> ''
       ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
     )
     SELECT s.id AS conflicting_shipment_id, mv.vessel_name
     FROM shipments s
     INNER JOIN master_vessels mv ON mv.id = $1
     LEFT JOIN contracts c ON s.contract_id = c.id
     LEFT JOIN latest_spd spd ON spd.contract_number = c.contract_id
     WHERE ${resolveExpr} = $1
       ${excludeClause}
       AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
       AND s.ata_discharge_complete IS NULL
       AND (
         NULLIF(TRIM(COALESCE(c.sto_number::text, spd.effective_sto, '')), '') IS NOT NULL
         OR (
           s.eta_arrival IS NOT NULL OR s.eta_berthed IS NOT NULL OR s.eta_loading_start IS NOT NULL
           OR s.eta_loading_complete IS NOT NULL OR s.eta_sailed IS NOT NULL
           OR s.eta_discharge_arrival IS NOT NULL OR s.eta_discharge_berthed IS NOT NULL
           OR s.eta_discharge_start IS NOT NULL OR s.eta_discharge_complete IS NOT NULL
         )
         OR s.ata_arrival IS NOT NULL OR s.ata_berthed IS NOT NULL OR s.ata_loading_start IS NOT NULL
         OR s.ata_loading_complete IS NOT NULL OR s.ata_sailed IS NOT NULL
         OR s.ata_discharge_arrival IS NOT NULL OR s.ata_discharge_berthed IS NOT NULL
         OR s.ata_discharge_start IS NOT NULL
       )
     LIMIT 1`,
    params,
  );

  const row = result.rows[0] as { conflicting_shipment_id: string; vessel_name: string } | undefined;
  if (!row) return null;

  return {
    master_vessel_id: masterId,
    vessel_name: row.vessel_name,
    conflicting_shipment_id: row.conflicting_shipment_id,
  };
}
