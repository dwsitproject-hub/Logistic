/**
 * Oil Loss page — eligible Incoterm × transport segment rules only.
 * Scope: GET /api/oil-loss (not Contract/Shipment/Trucking pages).
 *
 * Vessel: Incoterm CIF or FOB + SEA/MIX (or STO Type V).
 * Truck:  Incoterm FRC or CIF + LAND/MIX (or STO Type T).
 * All other incoterm × transport combinations are excluded.
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB'] as const;
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'CIF'] as const;

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  return (raw || 'LAND').toUpperCase();
}

export function normalizeOilLossStoType(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isOilLossVesselTransportMode(
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const m = normalizeOilLossMode(mode);
  const sto = normalizeOilLossStoType(stoType);
  return m === 'SEA' || m === 'MIX' || sto === 'V';
}

export function isOilLossTruckTransportMode(
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const m = normalizeOilLossMode(mode);
  const sto = normalizeOilLossStoType(stoType);
  return m === 'LAND' || m === 'MIX' || sto === 'T';
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const inc = normalizeOilLossIncoterm(incoterm);
  const vesselInc = (OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(inc);
  const truckInc = (OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(inc);
  if (!vesselInc && !truckInc) return false;
  if (vesselInc && isOilLossVesselTransportMode(mode, stoType)) return true;
  if (truckInc && isOilLossTruckTransportMode(mode, stoType)) return true;
  return false;
}

/** Resolved incoterm in enriched CTE (contract table preferred over SAP raw). */
export const OIL_LOSS_RESOLVED_INCOTERM_SQL = `UPPER(TRIM(COALESCE(
  NULLIF(contract_incoterm, ''),
  NULLIF(incoterm_raw, ''),
  ''
)))`;

/** Resolved transport mode in enriched CTE (SAP SEA / LAND field). */
export const OIL_LOSS_RESOLVED_MODE_SQL = `UPPER(TRIM(COALESCE(NULLIF(transport_mode, ''), 'LAND')))`;

export const OIL_LOSS_RESOLVED_STO_TYPE_SQL = `UPPER(TRIM(COALESCE(NULLIF(sto_type, ''), '')))`;

export const OIL_LOSS_VESSEL_TRANSPORT_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_MODE_SQL} IN ('SEA', 'MIX')
  OR ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'V'
)`;

export const OIL_LOSS_TRUCK_TRANSPORT_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_MODE_SQL} IN ('LAND', 'MIX')
  OR ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'T'
)`;

/** WHERE fragment — reference columns available on `enriched` / final row. */
export const OIL_LOSS_ELIGIBILITY_WHERE_SQL = `(
  (
    ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('CIF', 'FOB')
    AND ${OIL_LOSS_VESSEL_TRANSPORT_WHERE_SQL}
  )
  OR (
    ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('FRC', 'CIF')
    AND ${OIL_LOSS_TRUCK_TRANSPORT_WHERE_SQL}
  )
)`;

/**
 * Oil Loss transporter label on enriched/final row.
 * Truck segment → Truck Transporter (SAP); Vessel segment → Vessel Name (SAP).
 * trucking_owner_db / legacy SAP fields kept as fallbacks.
 */
export const OIL_LOSS_TRANSPORTER_EXPR = `CASE
  WHEN ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'V'
    OR (
      ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} <> 'T'
      AND ${OIL_LOSS_RESOLVED_MODE_SQL} = 'SEA'
    )
  THEN COALESCE(
    NULLIF(TRIM(vessel_name_raw), ''),
    NULLIF(TRIM(vessel_owner_raw), ''),
    NULLIF(TRIM(trucking_owner_db), ''),
    ''
  )
  WHEN ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'T'
    OR ${OIL_LOSS_RESOLVED_MODE_SQL} = 'LAND'
  THEN COALESCE(
    NULLIF(TRIM(truck_transporter_raw), ''),
    NULLIF(TRIM(trucking_owner_db), ''),
    NULLIF(TRIM(transporter_raw), ''),
    ''
  )
  ELSE COALESCE(
    NULLIF(TRIM(truck_transporter_raw), ''),
    NULLIF(TRIM(vessel_name_raw), ''),
    NULLIF(TRIM(trucking_owner_db), ''),
    NULLIF(TRIM(transporter_raw), ''),
    NULLIF(TRIM(vessel_owner_raw), ''),
    ''
  )
END`;
