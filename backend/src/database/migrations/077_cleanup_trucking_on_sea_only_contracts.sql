-- Remove trucking_operations incorrectly linked to SEA-only contracts.
-- SEA logistics belong on shipments; trucking is valid for LAND and MIX only.
--
-- Audit: SELECT * FROM cleanup_audit_077 ORDER BY deleted_at DESC;

CREATE TABLE IF NOT EXISTS cleanup_audit_077 (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID NOT NULL,
  contract_id UUID,
  contract_number VARCHAR(64),
  transport_mode VARCHAR(16),
  operation_id TEXT,
  created_at TIMESTAMP,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH to_delete AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    UPPER(TRIM(COALESCE(c.transport_mode, ''))) AS transport_mode,
    t.operation_id,
    t.created_at
  FROM trucking_operations t
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(c.transport_mode, ''))) = 'SEA'
),
audited AS (
  INSERT INTO cleanup_audit_077 (
    entity_type,
    entity_id,
    contract_id,
    contract_number,
    transport_mode,
    operation_id,
    created_at
  )
  SELECT
    'trucking_operations',
    id,
    contract_id,
    contract_number,
    transport_mode,
    operation_id,
    created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);
