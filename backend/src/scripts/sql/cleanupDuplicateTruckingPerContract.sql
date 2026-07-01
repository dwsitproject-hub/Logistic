-- Deduplicate trucking_operations: keep one row per contract_id, delete extras.
-- Keeper: best status > most daily_deliverables > latest updated_at.
-- Child rows (trucking_realizations, trucking_daily_actuals, documents) cascade.

BEGIN;

CREATE TABLE IF NOT EXISTS cleanup_audit_duplicate_trucking_per_contract (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL DEFAULT 'trucking_operations',
  entity_id UUID NOT NULL,
  contract_id UUID,
  contract_number VARCHAR(64),
  po_number VARCHAR(64),
  operation_id TEXT,
  status VARCHAR(32),
  created_at TIMESTAMP,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH dup_contracts AS (
  SELECT contract_id
  FROM trucking_operations
  WHERE contract_id IS NOT NULL
    AND COALESCE(status, '') <> 'CANCELLED'
  GROUP BY contract_id
  HAVING COUNT(*) > 1
),
keepers AS (
  SELECT DISTINCT ON (t.contract_id)
    t.contract_id,
    t.id AS keeper_id
  FROM trucking_operations t
  INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
  WHERE COALESCE(t.status, '') <> 'CANCELLED'
  ORDER BY
    t.contract_id,
    CASE UPPER(COALESCE(t.status, ''))
      WHEN 'COMPLETED' THEN 1
      WHEN 'IN_PROGRESS' THEN 2
      WHEN 'IN_TRANSIT' THEN 3
      WHEN 'LOADING' THEN 4
      WHEN 'UNLOADING' THEN 5
      WHEN 'PLANNED' THEN 6
      ELSE 7
    END ASC,
    COALESCE(jsonb_array_length(t.daily_deliverables), 0) DESC,
    t.updated_at DESC NULLS LAST,
    t.created_at DESC,
    t.id DESC
),
to_delete AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    t.created_at
  FROM trucking_operations t
  INNER JOIN dup_contracts d ON d.contract_id = t.contract_id
  INNER JOIN keepers k ON k.contract_id = t.contract_id
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE COALESCE(t.status, '') <> 'CANCELLED'
    AND t.id <> k.keeper_id
),
audited AS (
  INSERT INTO cleanup_audit_duplicate_trucking_per_contract (
    entity_id, contract_id, contract_number, po_number, operation_id, status, created_at
  )
  SELECT id, contract_id, contract_number, po_number, operation_id, status, created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

COMMIT;
