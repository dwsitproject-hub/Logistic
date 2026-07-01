-- Samples for LAND cardinality edge cases
WITH land AS (
  SELECT
    TRIM(spd.contract_number) AS contract_number,
    TRIM(spd.po_number) AS po_number,
    TRIM(COALESCE(
      spd.sto_number::text,
      spd.data->'raw'->>'STO No.',
      spd.data->'raw'->>'STO Number'
    )) AS sto_number
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(
    spd.data->'contract'->>'transport_mode',
    spd.data->'raw'->>'Transport Mode',
    'LAND'
  ))) = 'LAND'
    AND TRIM(COALESCE(spd.contract_number, '')) != ''
    AND TRIM(COALESCE(
      spd.sto_number::text,
      spd.data->'raw'->>'STO No.',
      spd.data->'raw'->>'STO Number', ''
    )) != ''
)
SELECT 'TOP PO with many STO' AS sample_type, po_number AS key1, contract_number AS key2,
       COUNT(DISTINCT sto_number)::text AS metric
FROM land
WHERE po_number IS NOT NULL AND po_number != ''
GROUP BY po_number, contract_number
HAVING COUNT(DISTINCT sto_number) >= 5
ORDER BY COUNT(DISTINCT sto_number) DESC
LIMIT 5;

-- STO shared across multiple PO/contract
WITH land AS (
  SELECT TRIM(spd.contract_number) AS contract_number, TRIM(spd.po_number) AS po_number,
    TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.')) AS sto_number
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(spd.data->'contract'->>'transport_mode', spd.data->'raw'->>'Transport Mode', 'LAND'))) = 'LAND'
    AND TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', '')) != ''
)
SELECT sto_number,
       COUNT(DISTINCT po_number) AS po_count,
       COUNT(DISTINCT contract_number) AS contract_count,
       STRING_AGG(DISTINCT po_number, ', ' ORDER BY po_number) AS pos
FROM land
GROUP BY sto_number
HAVING COUNT(DISTINCT po_number) > 1 OR COUNT(DISTINCT contract_number) > 1
ORDER BY COUNT(DISTINCT contract_number) DESC, COUNT(DISTINCT po_number) DESC
LIMIT 8;

-- Tri-key rows per contract (LAND)
SELECT contract_number, po_number, COUNT(DISTINCT sto_number) AS sto_lines, COUNT(*) AS spd_rows
FROM (
  SELECT TRIM(contract_number) AS contract_number, TRIM(po_number) AS po_number,
    TRIM(COALESCE(sto_number::text, data->'raw'->>'STO No.')) AS sto_number
  FROM sap_processed_data
  WHERE UPPER(TRIM(COALESCE(data->'contract'->>'transport_mode', data->'raw'->>'Transport Mode', 'LAND'))) = 'LAND'
) x
WHERE contract_number != ''
GROUP BY contract_number, po_number
ORDER BY sto_lines DESC
LIMIT 5;
