-- Hard-delete CANCELLED trucking_operations matching Rule A ∪ Rule B:
--   A) active keeper on same PO (or blank-PO contract_id)
--   B) orphan shell: no active keeper AND no trucking_daily_actuals
-- CANCELLED with WB but no keeper are kept.
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

ALTER TABLE cleanup_audit_cancelled_trucking_dedupe_losers
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

WITH cancelled AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    t.created_at,
    (
      SELECT COUNT(*)::int
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) AS wb_rows,
    EXISTS (
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
    ) AS has_active_keeper,
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
),
to_delete AS (
  SELECT
    id,
    contract_id,
    contract_number,
    po_number,
    operation_id,
    keeper_operation_id,
    status,
    created_at,
    CASE
      WHEN has_active_keeper THEN 'active_keeper'
      WHEN wb_rows = 0 THEN 'orphan_no_wb'
      ELSE NULL
    END AS delete_reason
  FROM cancelled
  WHERE has_active_keeper OR wb_rows = 0
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
    created_at,
    delete_reason
  )
  SELECT
    id,
    contract_id,
    contract_number,
    po_number,
    operation_id,
    keeper_operation_id,
    status,
    created_at,
    delete_reason
  FROM to_delete
  RETURNING entity_id
)
DELETE FROM trucking_operations t
WHERE t.id IN (SELECT entity_id FROM audited);

COMMIT;
