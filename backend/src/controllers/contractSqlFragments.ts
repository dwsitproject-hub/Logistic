/** Shared SQL fragments for contract list / performance queries. */

/**
 * Contract Performance source filter — column `contracts.source_type`.
 * DB/SAP values are typically `3rd Party` or `Inhouse`; UI label Interco maps to Inhouse/Interco.
 */
export function appendContractPerfSourceTypeFilter(
  sourceFilter: string | undefined,
  columnExpr = 'base.source_type',
): string {
  const f = String(sourceFilter || 'All').trim();
  if (!f || f === 'All') return '';
  const col = `UPPER(TRIM(COALESCE(${columnExpr}, '')))`;
  if (f === '3rd Party') {
    return ` AND (${col} LIKE '%3RD%PARTY%' OR ${col} = '3RD PARTY')`;
  }
  if (f === 'Interco') {
    return ` AND (${col} LIKE '%INTERCO%' OR ${col} LIKE '%INHOUSE%' OR ${col} LIKE '%IN-HOUSE%')`;
  }
  return '';
}

export const B2B_CHILD_EXCLUSION_SQL = `
  AND NOT (
    UPPER(TRIM(COALESCE(
      base.latest_spd_data->'contract'->>'contract_type',
      base.latest_spd_data->>'B2B Flag',
      ''
    ))) = 'B2B'
    AND NULLIF(TRIM(COALESCE(
      base.latest_spd_data->'contract'->>'contract_reference_po',
      base.latest_spd_data->>'CONTRACT REFF PO',
      base.latest_spd_data->>'Contract Reff PO Ini',
      base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
      base.latest_spd_data->'raw'->>'CONTRACT REFF PO'
    )), '') IS NOT NULL
  )`;
