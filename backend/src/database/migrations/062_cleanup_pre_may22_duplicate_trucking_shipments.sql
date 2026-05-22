-- Remove duplicate trucking/shipment rows from upload before 2026-05-22.
--
-- Per contract_id with 2+ rows:
--  A) Has sibling on/after 2026-05-22 → delete all pre-cutoff duplicates (any status).
--  B) All siblings pre-cutoff → delete only older PLANNED (trucking) / PLANNED+UNPLANNED (shipments).
--
-- Preview: backend/src/scripts/preview_cleanup_062_pre_may22_duplicates.sql
-- Audit:   SELECT * FROM cleanup_audit_062 ORDER BY deleted_at DESC;

CREATE TABLE IF NOT EXISTS cleanup_audit_062 (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID NOT NULL,
  contract_id UUID,
  operation_or_shipment_id TEXT,
  created_at TIMESTAMP,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Trucking ─────────────────────────────────────────────────────────────────
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
),
to_delete AS (
  SELECT
    t.id,
    t.contract_id,
    t.operation_id,
    t.created_at
  FROM trucking_operations t
  INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
  INNER JOIN group_meta gm ON gm.contract_id = t.contract_id
  INNER JOIN keepers k ON k.contract_id = t.contract_id
  WHERE t.created_at < TIMESTAMP '2026-05-22'
    AND t.id <> k.keeper_id
    AND (gm.has_post_cutoff OR UPPER(COALESCE(t.status, '')) = 'PLANNED')
),
audited AS (
  INSERT INTO cleanup_audit_062 (entity_type, entity_id, contract_id, operation_or_shipment_id, created_at)
  SELECT 'trucking_operations', id, contract_id, operation_id, created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

-- ── Shipments ────────────────────────────────────────────────────────────────
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
),
to_delete AS (
  SELECT
    s.id,
    s.contract_id,
    s.shipment_id,
    s.created_at
  FROM shipments s
  INNER JOIN dup_contracts d ON d.contract_id = s.contract_id
  INNER JOIN group_meta gm ON gm.contract_id = s.contract_id
  INNER JOIN keepers k ON k.contract_id = s.contract_id
  WHERE s.created_at < TIMESTAMP '2026-05-22'
    AND s.id <> k.keeper_id
    AND (gm.has_post_cutoff OR UPPER(COALESCE(s.status, '')) IN ('PLANNED', 'UNPLANNED'))
),
audited AS (
  INSERT INTO cleanup_audit_062 (entity_type, entity_id, contract_id, operation_or_shipment_id, created_at)
  SELECT 'shipments', id, contract_id, shipment_id, created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM shipments s
WHERE s.id IN (SELECT entity_id FROM audited);
