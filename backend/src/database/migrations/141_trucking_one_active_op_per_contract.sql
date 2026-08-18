-- One active trucking_operations row per contract_id (PO).
-- 1) Soft-dedupe existing active duplicates (keep WB/status/location keeper).
-- 2) Partial UNIQUE so SAP / Unplanned / WB / planning cannot insert a second active op.

-- Merge daily actuals from losers into keepers (same conflict target as WB).
WITH dup_contracts AS (
  SELECT contract_id
  FROM trucking_operations
  WHERE contract_id IS NOT NULL
    AND deduped_at IS NULL
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
  WHERE t.deduped_at IS NULL
    AND COALESCE(t.status, '') <> 'CANCELLED'
  ORDER BY
    t.contract_id,
    (
      SELECT COUNT(DISTINCT da.progress_date)
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) DESC,
    (
      SELECT COALESCE(SUM(
        COALESCE(da.quantity_delivery_kg, da.quantity_kg, 0)
        + COALESCE(da.quantity_receive_kg, 0)
      ), 0)
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) DESC,
    CASE UPPER(COALESCE(t.status, ''))
      WHEN 'COMPLETED' THEN 1
      WHEN 'IN_PROGRESS' THEN 2
      WHEN 'IN_TRANSIT' THEN 3
      WHEN 'LOADING' THEN 4
      WHEN 'UNLOADING' THEN 5
      WHEN 'PLANNED' THEN 6
      ELSE 7
    END ASC,
    CASE
      WHEN NULLIF(TRIM(t.loading_location), '') IS NOT NULL
        OR NULLIF(TRIM(t.unloading_location), '') IS NOT NULL
      THEN 0 ELSE 1
    END ASC,
    COALESCE(jsonb_array_length(t.daily_deliverables), 0) DESC,
    t.updated_at DESC NULLS LAST,
    t.created_at DESC,
    t.id DESC
),
losers AS (
  SELECT t.id AS loser_id, k.keeper_id, t.contract_id
  FROM trucking_operations t
  INNER JOIN keepers k ON k.contract_id = t.contract_id
  WHERE t.deduped_at IS NULL
    AND COALESCE(t.status, '') <> 'CANCELLED'
    AND t.id <> k.keeper_id
),
merged_actuals AS (
  INSERT INTO trucking_daily_actuals (
    trucking_operation_id,
    progress_date,
    quantity_kg,
    quantity_delivery_kg,
    quantity_receive_kg,
    source,
    wb_import_id,
    sto_number
  )
  SELECT
    l.keeper_id,
    da.progress_date,
    da.quantity_kg,
    da.quantity_delivery_kg,
    da.quantity_receive_kg,
    da.source,
    da.wb_import_id,
    COALESCE(NULLIF(TRIM(da.sto_number), ''), '')
  FROM losers l
  INNER JOIN trucking_daily_actuals da ON da.trucking_operation_id = l.loser_id
  ON CONFLICT (trucking_operation_id, progress_date, sto_number) DO UPDATE SET
    quantity_kg = GREATEST(
      COALESCE(trucking_daily_actuals.quantity_kg, 0),
      COALESCE(EXCLUDED.quantity_kg, 0)
    ),
    quantity_delivery_kg = GREATEST(
      COALESCE(trucking_daily_actuals.quantity_delivery_kg, 0),
      COALESCE(EXCLUDED.quantity_delivery_kg, 0)
    ),
    quantity_receive_kg = GREATEST(
      COALESCE(trucking_daily_actuals.quantity_receive_kg, 0),
      COALESCE(EXCLUDED.quantity_receive_kg, 0)
    ),
    source = COALESCE(EXCLUDED.source, trucking_daily_actuals.source),
    wb_import_id = COALESCE(EXCLUDED.wb_import_id, trucking_daily_actuals.wb_import_id)
  RETURNING trucking_operation_id
),
copied_locations AS (
  UPDATE trucking_operations k
  SET
    loading_location = COALESCE(NULLIF(TRIM(k.loading_location), ''), loc.loading_location),
    unloading_location = COALESCE(NULLIF(TRIM(k.unloading_location), ''), loc.unloading_location),
    location = COALESCE(NULLIF(TRIM(k.location), ''), loc.location),
    updated_at = CURRENT_TIMESTAMP
  FROM (
    SELECT
      x.keeper_id,
      MAX(NULLIF(TRIM(l.loading_location), '')) AS loading_location,
      MAX(NULLIF(TRIM(l.unloading_location), '')) AS unloading_location,
      MAX(NULLIF(TRIM(l.location), '')) AS location
    FROM losers x
    INNER JOIN trucking_operations l ON l.id = x.loser_id
    GROUP BY x.keeper_id
  ) loc
  WHERE k.id = loc.keeper_id
  RETURNING k.id
)
UPDATE trucking_operations t
SET
  deduped_at = CURRENT_TIMESTAMP,
  deduped_into_operation_id = l.keeper_id,
  deduped_reason = 'one_active_per_contract_uidx',
  updated_at = CURRENT_TIMESTAMP
FROM losers l
WHERE t.id = l.loser_id;

CREATE UNIQUE INDEX IF NOT EXISTS trucking_operations_one_active_per_contract_uidx
  ON trucking_operations (contract_id)
  WHERE deduped_at IS NULL
    AND COALESCE(status, '') <> 'CANCELLED';
