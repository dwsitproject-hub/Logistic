/** Shared SQL fragments for contract list / performance queries. */
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
