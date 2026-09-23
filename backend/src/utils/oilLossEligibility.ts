/**
 * Oil Loss page — eligible Incoterm segment rules.
 * Scope: GET /api/oil-loss (not Contract/Shipment/Trucking pages).
 *
 * Same allowlists as the Shipment and Trucking pages. SAP SEA / LAND is not a gate.
 * Vessel: CIF, FOB, CFR
 * Truck:  FRC, LCO
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB', 'CFR'] as const;
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'LCO'] as const;

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isOilLossVesselIncoterm(value: string | null | undefined): boolean {
  return (OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(normalizeOilLossIncoterm(value));
}

export function isOilLossTruckIncoterm(value: string | null | undefined): boolean {
  return (OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(normalizeOilLossIncoterm(value));
}

export type OilLossTransportSegmentRow = {
  incoterm?: string | null;
  transport_mode?: string | null;
  sto_type?: string | null;
};

export function matchesOilLossVesselSegment(row: OilLossTransportSegmentRow): boolean {
  return isOilLossVesselIncoterm(row.incoterm);
}

export function matchesOilLossTruckSegment(row: OilLossTransportSegmentRow): boolean {
  return isOilLossTruckIncoterm(row.incoterm);
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  _mode?: string | null | undefined,
  _stoType?: string | null | undefined,
): boolean {
  return isOilLossVesselIncoterm(incoterm) || isOilLossTruckIncoterm(incoterm);
}

/** Resolved incoterm in enriched CTE (contract table preferred over SAP raw). */
export const OIL_LOSS_RESOLVED_INCOTERM_SQL = `UPPER(TRIM(COALESCE(
  NULLIF(contract_incoterm, ''),
  NULLIF(incoterm_raw, ''),
  ''
)))`;

/** Vessel segment (CIF/FOB/CFR) — Shipments Attention loss rows. */
export const OIL_LOSS_VESSEL_ELIGIBILITY_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('CIF', 'FOB', 'CFR')
)`;

/** Trucking snapshot rows stay one PO per contract (FRC/LCO). Vessel rows are not in this set. */
export const OIL_LOSS_TRUCK_ELIGIBILITY_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('FRC', 'LCO')
)`;

/** WHERE fragment — reference columns available on `enriched` / final row. */
export const OIL_LOSS_ELIGIBILITY_WHERE_SQL = `(
  ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('CIF', 'FOB', 'CFR', 'FRC', 'LCO')
)`;

/**
 * Mode argument for the UAT quantity matrix. Derived from Incoterm so Oil Loss
 * does not read SAP SEA / LAND. Vessel incoterms take vessel qty; truck incoterms take trucking qty.
 */
export function sqlOilLossQtyTransportModeExpr(incotermExpr: string): string {
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${incotermExpr}, ''))) IN ('CIF', 'FOB', 'CFR') THEN 'SEA'
    ELSE 'LAND'
  END`;
}

/**
 * Oil Loss transporter label on enriched/final row.
 * Vessel incoterm → Vessel Name (SAP); Truck incoterm → Truck Transporter (SAP).
 */
export const OIL_LOSS_TRANSPORTER_EXPR = `CASE
  WHEN ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('CIF', 'FOB', 'CFR')
  THEN COALESCE(
    NULLIF(TRIM(vessel_name_raw), ''),
    NULLIF(TRIM(vessel_owner_raw), ''),
    NULLIF(TRIM(trucking_owner_db), ''),
    ''
  )
  WHEN ${OIL_LOSS_RESOLVED_INCOTERM_SQL} IN ('FRC', 'LCO')
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
