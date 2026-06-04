-- Preview rows that migration 062 will delete (run before applying on staging).
-- Cutoff: 2026-05-22 00:00:00
--
-- Rules per contract_id with 2+ trucking/shipment rows:
--  A) If any sibling created on/after 2026-05-22 → delete ALL pre-cutoff duplicates (any status).
--  B) If all siblings are pre-cutoff → delete only older PLANNED rows (keep newest PLANNED; leave COMPLETED).

\echo '=== TRUCKING duplicates to delete ==='
WITH dup_contracts AS (
  SELECT contract_id
  FROM trucking_operations
  WHERE contract_id IS NOT NULL
  GROUP BY contract_id
  HAVING COUNT(*) > 1
),
group_meta AS (
  SELECT
    t.contract_id,
    BOOL_OR(t.created_at >= TIMESTAMP '2026-05-22') AS has_post_cutoff
  FROM trucking_operations t
  INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
  GROUP BY t.contract_id
),
keepers AS (
  SELECT DISTINCT ON (t.contract_id)
    t.contract_id,
    t.id AS keeper_id
  FROM trucking_operations t
  INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
  ORDER BY
    t.contract_id,
    CASE WHEN t.created_at >= TIMESTAMP '2026-05-22' THEN 0 ELSE 1 END,
    CASE WHEN UPPER(COALESCE(t.status, '')) = 'PLANNED' THEN 0 ELSE 1 END,
    t.created_at DESC,
    t.updated_at DESC NULLS LAST,
    t.id
)
SELECT
  t.id,
  t.operation_id,
  t.status,
  t.created_at,
  c.contract_id AS sap_contract_no,
  c.po_number,
  sap.ext_no AS contract_ext_no,
  gm.has_post_cutoff
FROM trucking_operations t
INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
INNER JOIN group_meta gm ON gm.contract_id = t.contract_id
INNER JOIN contracts c ON c.id = t.contract_id
LEFT JOIN LATERAL (
  SELECT NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')), '') AS ext_no
  FROM sap_processed_data spd
  WHERE spd.contract_number = c.contract_id
  ORDER BY spd.created_at DESC NULLS LAST
  LIMIT 1
) sap ON TRUE
WHERE t.created_at < TIMESTAMP '2026-05-22'
  AND t.id <> (SELECT k.keeper_id FROM keepers k WHERE k.contract_id = t.contract_id)
  AND (
    gm.has_post_cutoff
    OR UPPER(COALESCE(t.status, '')) = 'PLANNED'
  )
ORDER BY sap.ext_no, t.created_at;

\echo ''
\echo '=== SHIPMENT duplicates to delete ==='
WITH dup_contracts AS (
  SELECT contract_id
  FROM shipments
  WHERE contract_id IS NOT NULL
  GROUP BY contract_id
  HAVING COUNT(*) > 1
),
group_meta AS (
  SELECT
    s.contract_id,
    BOOL_OR(s.created_at >= TIMESTAMP '2026-05-22') AS has_post_cutoff
  FROM shipments s
  INNER JOIN dup_contracts d ON d.contract_id = s.contract_id
  GROUP BY s.contract_id
),
keepers AS (
  SELECT DISTINCT ON (s.contract_id)
    s.contract_id,
    s.id AS keeper_id
  FROM shipments s
  INNER JOIN dup_contracts d ON d.contract_id = s.contract_id
  ORDER BY
    s.contract_id,
    CASE WHEN s.created_at >= TIMESTAMP '2026-05-22' THEN 0 ELSE 1 END,
    CASE WHEN UPPER(COALESCE(s.status, '')) IN ('PLANNED', 'UNPLANNED') THEN 0 ELSE 1 END,
    s.created_at DESC,
    s.updated_at DESC NULLS LAST,
    s.id
)
SELECT
  s.id,
  s.shipment_id,
  s.operation_id,
  s.vessel_name,
  s.status,
  s.created_at,
  c.contract_id AS sap_contract_no,
  c.po_number,
  sap.ext_no AS contract_ext_no,
  gm.has_post_cutoff
FROM shipments s
INNER JOIN dup_contracts d ON d.contract_id = s.contract_id
INNER JOIN group_meta gm ON gm.contract_id = s.contract_id
INNER JOIN contracts c ON c.id = s.contract_id
LEFT JOIN LATERAL (
  SELECT NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')), '') AS ext_no
  FROM sap_processed_data spd
  WHERE spd.contract_number = c.contract_id
  ORDER BY spd.created_at DESC NULLS LAST
  LIMIT 1
) sap ON TRUE
WHERE s.created_at < TIMESTAMP '2026-05-22'
  AND s.id <> (SELECT k.keeper_id FROM keepers k WHERE k.contract_id = s.contract_id)
  AND (
    gm.has_post_cutoff
    OR UPPER(COALESCE(s.status, '')) IN ('PLANNED', 'UNPLANNED')
  )
ORDER BY sap.ext_no, s.created_at;

\echo ''
\echo '=== Summary counts ==='
WITH trucking_del AS (
  SELECT t.id
  FROM trucking_operations t
  INNER JOIN (
    SELECT contract_id FROM trucking_operations WHERE contract_id IS NOT NULL GROUP BY contract_id HAVING COUNT(*) > 1
  ) d ON d.contract_id = t.contract_id
  INNER JOIN (
    SELECT contract_id, BOOL_OR(created_at >= TIMESTAMP '2026-05-22') AS has_post_cutoff
    FROM trucking_operations
    GROUP BY contract_id
  ) gm ON gm.contract_id = t.contract_id
  WHERE t.created_at < TIMESTAMP '2026-05-22'
    AND t.id <> (
      SELECT t3.id FROM trucking_operations t3
      WHERE t3.contract_id = t.contract_id
      ORDER BY
        CASE WHEN t3.created_at >= TIMESTAMP '2026-05-22' THEN 0 ELSE 1 END,
        CASE WHEN UPPER(COALESCE(t3.status, '')) = 'PLANNED' THEN 0 ELSE 1 END,
        t3.created_at DESC,
        t3.updated_at DESC NULLS LAST,
        t3.id
      LIMIT 1
    )
    AND (gm.has_post_cutoff OR UPPER(COALESCE(t.status, '')) = 'PLANNED')
),
shipment_del AS (
  SELECT s.id
  FROM shipments s
  INNER JOIN (
    SELECT contract_id FROM shipments WHERE contract_id IS NOT NULL GROUP BY contract_id HAVING COUNT(*) > 1
  ) d ON d.contract_id = s.contract_id
  INNER JOIN (
    SELECT contract_id, BOOL_OR(created_at >= TIMESTAMP '2026-05-22') AS has_post_cutoff
    FROM shipments
    GROUP BY contract_id
  ) gm ON gm.contract_id = s.contract_id
  WHERE s.created_at < TIMESTAMP '2026-05-22'
    AND s.id <> (
      SELECT s3.id FROM shipments s3
      WHERE s3.contract_id = s.contract_id
      ORDER BY
        CASE WHEN s3.created_at >= TIMESTAMP '2026-05-22' THEN 0 ELSE 1 END,
        CASE WHEN UPPER(COALESCE(s3.status, '')) IN ('PLANNED', 'UNPLANNED') THEN 0 ELSE 1 END,
        s3.created_at DESC,
        s3.updated_at DESC NULLS LAST,
        s3.id
      LIMIT 1
    )
    AND (gm.has_post_cutoff OR UPPER(COALESCE(s.status, '')) IN ('PLANNED', 'UNPLANNED'))
)
SELECT 'trucking_operations' AS entity, COUNT(*) AS rows_to_delete FROM trucking_del
UNION ALL
SELECT 'shipments', COUNT(*) FROM shipment_del;
