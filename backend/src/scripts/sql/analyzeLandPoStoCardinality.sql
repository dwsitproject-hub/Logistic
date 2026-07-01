-- SAP LAND: Contract/PO vs STO cardinality analysis
WITH land_spd AS (
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
      spd.data->'contract'->>'transport_mode',
      spd.data->'raw'->>'Transport Mode',
      spd.data->>'transport_mode',
      'LAND'
    ))) AS transport_mode,
    UPPER(TRIM(COALESCE(
      spd.data->'contract'->>'incoterm',
      spd.data->'raw'->>'Incoterm',
      spd.data->>'incoterm'
    ))) AS incoterm,
    spd.id
  FROM sap_processed_data spd
  WHERE TRIM(COALESCE(spd.contract_number, '')) != ''
),
land AS (
  SELECT * FROM land_spd
  WHERE transport_mode = 'LAND'
    AND sto_number IS NOT NULL AND sto_number != ''
),
-- 1 PO -> many STO
po_to_sto AS (
  SELECT po_number, COUNT(DISTINCT sto_number) AS sto_count, COUNT(DISTINCT contract_number) AS contract_count
  FROM land
  WHERE po_number IS NOT NULL AND po_number != ''
  GROUP BY po_number
),
-- 1 Contract -> many STO
contract_to_sto AS (
  SELECT contract_number, COUNT(DISTINCT sto_number) AS sto_count, COUNT(DISTINCT po_number) AS po_count
  FROM land
  GROUP BY contract_number
),
-- 1 STO -> many PO
sto_to_po AS (
  SELECT sto_number, COUNT(DISTINCT po_number) AS po_count, COUNT(DISTINCT contract_number) AS contract_count
  FROM land
  GROUP BY sto_number
),
-- 1 STO -> many Contract
sto_to_contract AS (
  SELECT sto_number, COUNT(DISTINCT contract_number) AS contract_count, COUNT(DISTINCT po_number) AS po_count
  FROM land
  GROUP BY sto_number
)
SELECT 'land_rows_with_sto' AS metric, COUNT(*)::text AS value FROM land
UNION ALL SELECT 'distinct_contracts', COUNT(DISTINCT contract_number)::text FROM land
UNION ALL SELECT 'distinct_pos', COUNT(DISTINCT po_number)::text FROM land WHERE po_number IS NOT NULL AND po_number != ''
UNION ALL SELECT 'distinct_stos', COUNT(DISTINCT sto_number)::text FROM land
UNION ALL SELECT 'po_with_multiple_sto', COUNT(*)::text FROM po_to_sto WHERE sto_count > 1
UNION ALL SELECT 'contract_with_multiple_sto', COUNT(*)::text FROM contract_to_sto WHERE sto_count > 1
UNION ALL SELECT 'sto_with_multiple_po', COUNT(*)::text FROM sto_to_po WHERE po_count > 1
UNION ALL SELECT 'sto_with_multiple_contract', COUNT(*)::text FROM sto_to_contract WHERE contract_count > 1
UNION ALL SELECT 'max_sto_per_po', MAX(sto_count)::text FROM po_to_sto
UNION ALL SELECT 'max_sto_per_contract', MAX(sto_count)::text FROM contract_to_sto
UNION ALL SELECT 'max_po_per_sto', MAX(po_count)::text FROM sto_to_po
UNION ALL SELECT 'max_contract_per_sto', MAX(contract_count)::text FROM sto_to_contract;
