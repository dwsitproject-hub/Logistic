-- LAND SAP: STO empty vs filled
WITH land AS (
  SELECT
    TRIM(spd.contract_number) AS contract_number,
    TRIM(spd.po_number) AS po_number,
    TRIM(COALESCE(
      spd.sto_number::text,
      spd.data->'raw'->>'STO No.',
      spd.data->'raw'->>'STO Number',
      spd.data->'shipment'->>'sto_no',
      spd.data->'contract'->>'sto_no'
    )) AS sto_number,
    UPPER(TRIM(COALESCE(
      spd.data->'contract'->>'status',
      spd.data->'raw'->>'Status',
      spd.data->>'status',
      ''
    ))) AS sap_status
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(
    spd.data->'contract'->>'transport_mode',
    spd.data->'raw'->>'Transport Mode',
    spd.data->>'transport_mode',
    'LAND'
  ))) = 'LAND'
    AND TRIM(COALESCE(spd.contract_number, '')) != ''
)
SELECT
  COUNT(*) AS total_land_rows,
  COUNT(*) FILTER (WHERE sto_number IS NULL OR sto_number = '') AS sto_empty_rows,
  COUNT(*) FILTER (WHERE sto_number IS NOT NULL AND sto_number != '') AS sto_filled_rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sto_number IS NULL OR sto_number = '') / NULLIF(COUNT(*), 0), 1) AS pct_sto_empty,
  COUNT(DISTINCT contract_number) AS distinct_contracts,
  COUNT(DISTINCT contract_number) FILTER (WHERE sto_number IS NULL OR sto_number = '') AS contracts_with_any_empty_sto_row,
  COUNT(DISTINCT contract_number) FILTER (
    WHERE contract_number NOT IN (
      SELECT DISTINCT contract_number FROM land WHERE sto_number IS NOT NULL AND sto_number != ''
    )
  ) AS contracts_never_have_sto,
  COUNT(DISTINCT po_number) FILTER (WHERE po_number IS NOT NULL AND po_number != '') AS distinct_pos
FROM land;

-- Contracts table LAND: sto on master vs contract_stos
SELECT
  COUNT(*) AS land_contracts,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(sto_number::text), '') IS NULL) AS master_sto_empty,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM contract_stos cs WHERE cs.contract_id = c.id
  )) AS has_contract_stos_rows,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM contract_stos cs WHERE cs.contract_id = c.id
  )) AS no_contract_stos
FROM contracts c
WHERE UPPER(COALESCE(NULLIF(TRIM(transport_mode), ''), 'LAND')) = 'LAND';

-- Trucking ops on contracts without STO
SELECT
  COUNT(DISTINCT t.id) AS trucking_ops,
  COUNT(DISTINCT t.id) FILTER (
    WHERE NULLIF(TRIM(c.sto_number::text), '') IS NULL
      AND NOT EXISTS (SELECT 1 FROM contract_stos cs WHERE cs.contract_id = c.id)
  ) AS ops_no_sto_at_all
FROM trucking_operations t
JOIN contracts c ON c.id = t.contract_id
WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'LAND')) = 'LAND';
