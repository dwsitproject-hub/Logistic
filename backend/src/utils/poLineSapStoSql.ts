/** SAP effective STO number from sap_processed_data row. */
function spdEffectiveStoSql(alias: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${alias}.sto_number::text,
    ${alias}.data->'raw'->>'STO No.',
    ${alias}.data->'raw'->>'STO Number',
    ${alias}.data->'shipment'->>'sto_no',
    ${alias}.data->'contract'->>'sto_no'
  )), '')`;
}

function spdPoNumberSql(alias: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${alias}.po_number::text,
    ${alias}.data->'raw'->>'PO No.',
    ${alias}.data->'raw'->>'PO Number',
    ${alias}.data->'raw'->>'PO No',
    ${alias}.data->'contract'->>'po_number',
    ${alias}.data->>'PO No.'
  )), '')`;
}

/**
 * PostgreSQL expression: true when this contracts row already has an official STO from SAP.
 * Manual Add PO on Edit Shipment is allowed only when this is false.
 */
export function poLineHasSapStoSql(contractAlias: string): string {
  const c = contractAlias;
  return `(
    NULLIF(TRIM(COALESCE(${c}.sto_number::text, '')), '') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM contract_stos cs
      WHERE cs.contract_id = ${c}.id
    )
    OR EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE spd.contract_number = ${c}.contract_id
        AND ${spdEffectiveStoSql('spd')} IS NOT NULL
        AND (
          NULLIF(TRIM(COALESCE(${c}.po_number::text, '')), '') IS NULL
          OR ${spdPoNumberSql('spd')} = NULLIF(TRIM(COALESCE(${c}.po_number::text, '')), '')
        )
    )
  )`;
}
