/**
 * Resolve commercial contract rows for Tanda Terima PDF by contract ext no.
 */

export function buildTandaTerimaContractsByExtNoSql(): string {
  return `
    WITH latest_spd AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        spd.data,
        spd.created_at
      FROM sap_processed_data spd
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    ),
    requested AS (
      SELECT unnest($1::text[]) AS contract_ext_no
    ),
    contract_rows AS (
      SELECT
        COALESCE(
          NULLIF(TRIM(latest_spd.data->'raw'->>'Contract Ext No'), ''),
          NULLIF(TRIM(latest_spd.data->>'Contract Ext No'), ''),
          c.contract_id
        ) AS contract_ext_no,
        NULLIF(TRIM(c.supplier), '') AS supplier
      FROM contracts c
      LEFT JOIN latest_spd ON latest_spd.contract_number = c.contract_id
      WHERE COALESCE(
        NULLIF(TRIM(latest_spd.data->'raw'->>'Contract Ext No'), ''),
        NULLIF(TRIM(latest_spd.data->>'Contract Ext No'), ''),
        c.contract_id
      ) IS NOT NULL
    )
    SELECT DISTINCT ON (r.contract_ext_no)
      r.contract_ext_no,
      cr.supplier
    FROM requested r
    INNER JOIN contract_rows cr ON cr.contract_ext_no = r.contract_ext_no
    ORDER BY r.contract_ext_no ASC`;
}
