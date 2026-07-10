-- Percentages and STO type for shared STO cases
WITH land AS (
  SELECT
    TRIM(spd.contract_number) AS contract_number,
    TRIM(spd.po_number) AS po_number,
    TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.')) AS sto_number,
    UPPER(TRIM(COALESCE(spd.data->'raw'->>'STO Type', spd.data->'contract'->>'sto_type', ''))) AS sto_type
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(spd.data->'contract'->>'transport_mode', spd.data->'raw'->>'Transport Mode', 'LAND'))) = 'LAND'
    AND TRIM(COALESCE(spd.contract_number, '')) != ''
),
po_stats AS (
  SELECT po_number,
         COUNT(DISTINCT sto_number) FILTER (WHERE sto_number IS NOT NULL AND sto_number != '') AS sto_count,
         COUNT(DISTINCT contract_number) AS contract_count
  FROM land WHERE po_number IS NOT NULL AND po_number != ''
  GROUP BY po_number
),
contract_po AS (
  SELECT COUNT(DISTINCT po_number)::numeric AS pos,
         COUNT(DISTINCT contract_number)::numeric AS contracts,
         COUNT(*) FILTER (WHERE contract_count = 1 AND sto_count = 1)::numeric AS po_1sto,
         COUNT(*) FILTER (WHERE sto_count > 1)::numeric AS po_multisto,
         COUNT(*)::numeric AS total_pos
  FROM po_stats
)
SELECT
  ROUND(100.0 * po_multisto / NULLIF(total_pos, 0), 1) AS pct_po_with_multiple_sto,
  ROUND(100.0 * po_1sto / NULLIF(total_pos, 0), 1) AS pct_po_with_single_sto,
  total_pos::int AS total_pos
FROM contract_po;

-- Is PO always 1:1 with contract in LAND?
WITH land AS (
  SELECT TRIM(contract_number) AS contract_number, TRIM(po_number) AS po_number
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(data->'contract'->>'transport_mode', data->'raw'->>'Transport Mode', 'LAND'))) = 'LAND'
    AND TRIM(COALESCE(contract_number, '')) != ''
    AND TRIM(COALESCE(po_number, '')) != ''
)
SELECT
  COUNT(DISTINCT po_number) AS distinct_po,
  COUNT(DISTINCT contract_number) AS distinct_contract,
  COUNT(*) AS spd_rows,
  COUNT(DISTINCT (po_number, contract_number)) AS po_contract_pairs
FROM land;

-- Shared STO: sto types
WITH land AS (
  SELECT TRIM(contract_number) AS contract_number, TRIM(po_number) AS po_number,
    TRIM(COALESCE(sto_number::text, data->'raw'->>'STO No.')) AS sto_number,
    UPPER(TRIM(COALESCE(data->'raw'->>'STO Type', data->'contract'->>'sto_type', ''))) AS sto_type
  FROM sap_processed_data spd
  WHERE UPPER(TRIM(COALESCE(data->'contract'->>'transport_mode', data->'raw'->>'Transport Mode', 'LAND'))) = 'LAND'
    AND TRIM(COALESCE(sto_number::text, data->'raw'->>'STO No.', '')) != ''
),
shared AS (
  SELECT sto_number FROM land GROUP BY sto_number HAVING COUNT(DISTINCT contract_number) > 1
)
SELECT l.sto_type, COUNT(DISTINCT l.sto_number) AS shared_sto_count
FROM land l INNER JOIN shared s ON s.sto_number = l.sto_number
GROUP BY l.sto_type ORDER BY shared_sto_count DESC;
