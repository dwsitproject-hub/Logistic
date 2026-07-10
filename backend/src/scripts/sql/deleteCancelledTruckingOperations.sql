-- Delete all trucking_operations with status CANCELLED (local cleanup).
-- Child rows (trucking_realizations, trucking_daily_actuals, documents) cascade.
-- Preview: run the SELECT in to_delete only.

BEGIN;

CREATE TABLE IF NOT EXISTS cleanup_audit_cancelled_trucking (
  id SERIAL PRIMARY KEY,
  entity_id UUID NOT NULL,
  contract_id UUID,
  contract_number VARCHAR(64),
  po_number VARCHAR(64),
  operation_id TEXT,
  status VARCHAR(32),
  created_at TIMESTAMP,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH to_delete AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    t.created_at
  FROM trucking_operations t
  LEFT JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
),
audited AS (
  INSERT INTO cleanup_audit_cancelled_trucking (
    entity_id, contract_id, contract_number, po_number, operation_id, status, created_at
  )
  SELECT id, contract_id, contract_number, po_number, operation_id, status, created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

COMMIT;
