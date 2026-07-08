import { query } from '../database/connection';

/** Official SAP STO numbers are numeric (e.g. 1006018900). */
export function isOfficialSapStoNumber(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s);
}

const SHIPMENT_OR_PORT_ETA_PREDICATE = `
  s.eta_arrival IS NOT NULL
  OR s.eta_berthed IS NOT NULL
  OR s.eta_loading_start IS NOT NULL
  OR s.eta_loading_complete IS NOT NULL
  OR s.eta_sailed IS NOT NULL
  OR s.eta_discharge_arrival IS NOT NULL
  OR s.eta_discharge_berthed IS NOT NULL
  OR s.eta_discharge_start IS NOT NULL
  OR s.eta_discharge_complete IS NOT NULL
  OR vlp.eta_vessel_arrival IS NOT NULL
  OR vlp.eta_vessel_berthed IS NOT NULL
  OR vlp.eta_loading_start IS NOT NULL
  OR vlp.eta_loading_completed IS NOT NULL
  OR vlp.eta_vessel_sailed IS NOT NULL
  OR vlp.eta_vessel_complete_discharge IS NOT NULL
`;

/**
 * True when an official SAP STO already has shipment-level or port-level ETA registered
 * on any non-cancelled shipment linked to the STO.
 */
export async function officialSapStoHasRegisteredPlanning(stoNumber: string): Promise<boolean> {
  const sto = String(stoNumber ?? '').trim();
  if (!sto || !isOfficialSapStoNumber(sto)) return false;

  const result = await query(
    `
    SELECT 1
    FROM contracts c
    INNER JOIN shipments s ON s.contract_id = c.id
    LEFT JOIN vessel_loading_ports vlp ON vlp.shipment_id = s.id
    WHERE (
      TRIM(COALESCE(c.sto_number, '')) = $1
      OR TRIM(COALESCE(s.operation_id, '')) = $1
    )
      AND COALESCE(UPPER(TRIM(s.status)), '') <> 'CANCELLED'
      AND (${SHIPMENT_OR_PORT_ETA_PREDICATE})
    LIMIT 1
  `,
    [sto],
  );

  return result.rows.length > 0;
}
