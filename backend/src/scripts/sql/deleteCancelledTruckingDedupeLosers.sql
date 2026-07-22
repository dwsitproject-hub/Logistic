-- Hard-delete CANCELLED trucking_operations that still have an active sibling
-- on the same PO (dedupe losers). Manual CANCELLED without an active keeper are kept.
-- Child rows (trucking_realizations, trucking_daily_actuals, documents) cascade.
--
-- Preview first: previewCancelledTruckingDedupeLosers.sql

BEGIN;

CREATE TABLE IF NOT EXISTS cleanup_audit_cancelled_trucking_dedupe_losers (
  id SERIAL PRIMARY KEY,
  entity_id UUID NOT NULL,
  contract_id UUID,
  contract_number VARCHAR(64),
  po_number VARCHAR(64),
  operation_id TEXT,
  keeper_operation_id TEXT,
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
    t.created_at,
    (
      SELECT tk.operation_id
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
      ORDER BY tk.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS keeper_operation_id
  FROM trucking_operations t
  LEFT JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
    AND EXISTS (
      SELECT 1
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
    )
),
audited AS (
  INSERT INTO cleanup_audit_cancelled_trucking_dedupe_losers (
    entity_id,
    contract_id,
    contract_number,
    po_number,
    operation_id,
    keeper_operation_id,
    status,
    created_at
  )
  SELECT
    id,
    contract_id,
    contract_number,
    po_number,
    operation_id,
    keeper_operation_id,
    status,
    created_at
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

COMMIT;
