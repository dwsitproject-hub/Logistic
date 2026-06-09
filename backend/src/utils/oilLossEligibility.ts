/**
 * Oil Loss page — eligible Incoterm × Mode combinations only.
 * Scope: GET /api/oil-loss (not Contract/Shipment/Trucking pages).
 *
 * Rule 1: CIF + LAND or MIX
 * Rule 2: FOB + SEA, LAND, or MIX
 * Rule 3: LCO + SEA, LAND, or MIX
 */

export const OIL_LOSS_ELIGIBLE_MODES = {
  CIF: ['LAND', 'MIX'] as const,
  FOB: ['SEA', 'LAND', 'MIX'] as const,
  LCO: ['SEA', 'LAND', 'MIX'] as const,
} as const;

export type OilLossEligibleIncoterm = keyof typeof OIL_LOSS_ELIGIBLE_MODES;

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  return (raw || 'LAND').toUpperCase();
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  const inc = normalizeOilLossIncoterm(incoterm);
  const m = normalizeOilLossMode(mode);
  if (inc === 'CIF') return (OIL_LOSS_ELIGIBLE_MODES.CIF as readonly string[]).includes(m);
  if (inc === 'FOB') return (OIL_LOSS_ELIGIBLE_MODES.FOB as readonly string[]).includes(m);
  if (inc === 'LCO') return (OIL_LOSS_ELIGIBLE_MODES.LCO as readonly string[]).includes(m);
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

/** WHERE fragment — reference columns available on `enriched` / final row. */
export const OIL_LOSS_ELIGIBILITY_WHERE_SQL = `(
  (${OIL_LOSS_RESOLVED_INCOTERM_SQL} = 'CIF' AND ${OIL_LOSS_RESOLVED_MODE_SQL} IN ('LAND', 'MIX'))
  OR (${OIL_LOSS_RESOLVED_INCOTERM_SQL} = 'FOB' AND ${OIL_LOSS_RESOLVED_MODE_SQL} IN ('SEA', 'LAND', 'MIX'))
  OR (${OIL_LOSS_RESOLVED_INCOTERM_SQL} = 'LCO' AND ${OIL_LOSS_RESOLVED_MODE_SQL} IN ('SEA', 'LAND', 'MIX'))
)`;
