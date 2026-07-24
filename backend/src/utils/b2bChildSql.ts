/** B2B child contract exclusion — shared SQL (no heavy metric imports). */

const B2B_CHILD_WHERE = (b2bAlias: string) => `NOT (
  UPPER(TRIM(COALESCE(${b2bAlias}.b2b_flag, ''))) = 'B2B'
  AND NULLIF(TRIM(COALESCE(${b2bAlias}.contract_reference_po, '')), '') IS NOT NULL
)`;

export function sqlB2bChildExcludeWhere(b2bAlias = 'b2b'): string {
  return B2B_CHILD_WHERE(b2bAlias);
}

/** Exclude B2B child contracts when aggregating STO-linked PO/contract lists (no b2b join). */
export function sqlB2bChildContractRowExcludeWhere(contractAlias = 'cc'): string {
  return `NOT (
    UPPER(TRIM(COALESCE(
      (
        SELECT UPPER(TRIM(COALESCE(
          spd.data->'contract'->>'contract_type',
          spd.data->>'B2B Flag',
          ${contractAlias}.contract_type::text,
          ''
        )))
        FROM sap_processed_data spd
        WHERE TRIM(spd.contract_number) = TRIM(${contractAlias}.contract_id)
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ),
      UPPER(TRIM(COALESCE(${contractAlias}.contract_type::text, ''))),
      ''
    ))) = 'B2B'
    AND NULLIF(TRIM(COALESCE(
      (
        SELECT NULLIF(TRIM(COALESCE(
          spd.data->'contract'->>'contract_reference_po',
          spd.data->>'CONTRACT REFF PO',
          spd.data->'raw'->>'Contract Reff PO Ini',
          spd.data->'raw'->>'CONTRACT REFF PO'
        )), '')
        FROM sap_processed_data spd
        WHERE TRIM(spd.contract_number) = TRIM(${contractAlias}.contract_id)
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ),
      ''
    )), '') IS NOT NULL
  )`;
}

/** Exclude B2B child rows from spd_keyed JSON aggregates (PO column hydrate). */
export function sqlB2bChildSpdDataExcludeWhere(spdDataExpr = 'sk.data'): string {
  return `NOT (
    UPPER(TRIM(COALESCE(
      ${spdDataExpr}->'contract'->>'contract_type',
      ${spdDataExpr}->>'B2B Flag',
      ''
    ))) = 'B2B'
    AND NULLIF(TRIM(COALESCE(
      ${spdDataExpr}->'contract'->>'contract_reference_po',
      ${spdDataExpr}->>'CONTRACT REFF PO',
      ${spdDataExpr}->'raw'->>'Contract Reff PO Ini',
      ${spdDataExpr}->'raw'->>'CONTRACT REFF PO'
    )), '') IS NOT NULL
  )`;
}
