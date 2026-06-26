/**
 * Trucking page + contract "without trucking" scope — Incoterm FRC / LCO only.
 * More reliable than SAP Sea/Land for land-truck contracts (aligned with Oil Loss truck segment).
 */

export const TRUCKING_PAGE_INCOTERMS = ['FRC', 'LCO'] as const;

export type TruckingPageIncoterm = (typeof TRUCKING_PAGE_INCOTERMS)[number];

export function normalizeTruckingIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isTruckingPageIncoterm(value: string | null | undefined): boolean {
  const inc = normalizeTruckingIncoterm(value);
  return (TRUCKING_PAGE_INCOTERMS as readonly string[]).includes(inc);
}

/** Resolve incoterm from SAP parsed row (contract + raw) with optional DB fallback. */
export function resolveTruckingIncotermFromParsedData(
  parsedData: unknown,
  contractIncotermFromDb?: string | null,
): string {
  const p = parsedData as {
    contract?: { incoterm?: unknown };
    raw?: Record<string, unknown>;
  } | null;
  const candidates = [
    contractIncotermFromDb,
    p?.contract?.incoterm,
    p?.raw?.['Incoterm'],
    p?.raw?.incoterm,
  ];
  for (const value of candidates) {
    const normalized = normalizeTruckingIncoterm(
      value == null ? '' : String(value),
    );
    if (normalized) return normalized;
  }
  return '';
}

/** Effective incoterm from contract row with latest SAP fallback. */
export function contractEffectiveIncotermExpr(contractAlias = 'c'): string {
  return `UPPER(TRIM(COALESCE(
    NULLIF(TRIM(${contractAlias}.incoterm), ''),
    (
      SELECT COALESCE(
        spd.data->'contract'->>'incoterm',
        spd.data->'raw'->>'Incoterm',
        spd.data->>'Incoterm'
      )
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM((${contractAlias}).contract_id::text)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ),
    ''
  )))`;
}

/** Trucking page scope: FRC or LCO incoterm only. */
export function buildTruckingPageIncotermScopeSql(contractAlias = 'c'): string {
  return `${contractEffectiveIncotermExpr(contractAlias)} IN ('FRC', 'LCO')`;
}

export function buildTruckingPageListScopeSql(): string {
  return buildTruckingPageIncotermScopeSql('c');
}

/** AND-prefixed WHERE fragment for trucking list, calendar, get-by-id, and contract suggestions. */
export const truckingPageListScopeWhereSql = `AND ${buildTruckingPageListScopeSql()}`;

/** @deprecated Use truckingPageListScopeWhereSql — kept for import compatibility. */
export const truckingPageLandTransportForContractWhereSql = truckingPageListScopeWhereSql;
