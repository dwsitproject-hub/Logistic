/**
 * Oil Loss page — eligible Incoterm × transport segment rules only.
 * Scope: GET /api/oil-loss (not Contract/Shipment/Trucking pages).
 *
 * Vessel: (FOB|CIF) + (SEA or (MIX + STO Type V))
 * Truck:  (FRC|LCO) + LAND
 * All other incoterm × transport combinations are excluded.
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB'] as const;
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'LCO'] as const;

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Normalize SAP SEA / LAND / MIX (case-insensitive; MIXED → MIX). */
export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'LAND';
  const upper = raw.toUpperCase();
  if (upper === 'MIXED' || upper === 'MIX') return 'MIX';
  if (upper === 'SEA') return 'SEA';
  if (upper === 'LAND') return 'LAND';
  return upper;
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
  return m === 'SEA' || (m === 'MIX' && sto === 'V');
}

export function isOilLossTruckTransportMode(mode: string | null | undefined): boolean {
  return normalizeOilLossMode(mode) === 'LAND';
}

export type OilLossTransportSegmentRow = {
  incoterm?: string | null;
  transport_mode?: string | null;
  sto_type?: string | null;
};

export function matchesOilLossVesselSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm);
  if (!(OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(inc)) return false;
  return isOilLossVesselTransportMode(row.transport_mode, row.sto_type);
}

export function matchesOilLossTruckSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm);
  if (!(OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(inc)) return false;
  return isOilLossTruckTransportMode(row.transport_mode);
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const row: OilLossTransportSegmentRow = {
    incoterm,
    transport_mode: mode,
    sto_type: stoType,
  };
  return matchesOilLossVesselSegment(row) || matchesOilLossTruckSegment(row);
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
  ${OIL_LOSS_RESOLVED_MODE_SQL} = 'SEA'
  OR (${OIL_LOSS_RESOLVED_MODE_SQL} = 'MIX' AND ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'V')
)`;

export const OIL_LOSS_TRUCK_TRANSPORT_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_MODE_SQL} = 'LAND'
)`;

/** WHERE fragment — reference columns available on `enriched` / final row. */
export const OIL_LOSS_ELIGIBILITY_WHERE_SQL = `(
  (
    ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('CIF', 'FOB')
    AND ${OIL_LOSS_VESSEL_TRANSPORT_WHERE_SQL}
  )
  OR (
    ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('FRC', 'LCO')
    AND ${OIL_LOSS_TRUCK_TRANSPORT_WHERE_SQL}
  )
)`;

/**
 * Oil Loss transporter label on enriched/final row.
 * Vessel segment → Vessel Name (SAP); Truck segment → Truck Transporter (SAP).
 */
export const OIL_LOSS_TRANSPORTER_EXPR = `CASE
  WHEN ${OIL_LOSS_RESOLVED_MODE_SQL} = 'SEA'
    OR (${OIL_LOSS_RESOLVED_MODE_SQL} = 'MIX' AND ${OIL_LOSS_RESOLVED_STO_TYPE_SQL} = 'V')
  THEN COALESCE(
    NULLIF(TRIM(vessel_name_raw), ''),
    NULLIF(TRIM(vessel_owner_raw), ''),
    NULLIF(TRIM(trucking_owner_db), ''),
    ''
  )
  WHEN ${OIL_LOSS_RESOLVED_MODE_SQL} = 'LAND'
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
