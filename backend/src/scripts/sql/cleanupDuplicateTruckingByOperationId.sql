-- Remove trucking_operations that share the same operation_id across multiple rows
-- (cross-PO duplicate from Unplanned template upload before upsert guard).
-- Deletes ALL rows in each duplicate operation_id group (re-upload per PO after cleanup).
-- Child rows (trucking_realizations, trucking_daily_actuals, documents) cascade.

BEGIN;

CREATE TABLE IF NOT EXISTS cleanup_audit_duplicate_trucking_op_id (
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

WITH dup_op_ids AS (
  SELECT TRIM(t.operation_id::text) AS op_key
  FROM trucking_operations t
  WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
    AND COALESCE(t.status, '') <> 'CANCELLED'
  GROUP BY TRIM(t.operation_id::text)
  HAVING COUNT(*) > 1
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
  INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE COALESCE(t.status, '') <> 'CANCELLED'
),
audited AS (
  INSERT INTO cleanup_audit_duplicate_trucking_op_id (
    entity_id, contract_id, contract_number, po_number, operation_id, status, created_at
  )
  SELECT id, contract_id, contract_number, po_number, operation_id, status, created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

COMMIT;
