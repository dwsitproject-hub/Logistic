-- Non-destructive extension: planning stays on trucking_operations; realization isolated here.

CREATE TABLE IF NOT EXISTS trucking_realizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trucking_operation_id UUID NOT NULL UNIQUE REFERENCES trucking_operations(id) ON DELETE CASCADE,
  realization_start_date DATE,
  realization_end_date DATE,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sap_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trucking_realizations_operation
  ON trucking_realizations (trucking_operation_id);

CREATE TABLE IF NOT EXISTS trucking_daily_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trucking_operation_id UUID NOT NULL REFERENCES trucking_operations(id) ON DELETE CASCADE,
  progress_date DATE NOT NULL,
  quantity_kg NUMERIC(15, 2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (trucking_operation_id, progress_date)
);

CREATE INDEX IF NOT EXISTS idx_trucking_daily_actuals_operation_date
  ON trucking_daily_actuals (trucking_operation_id, progress_date);

-- Backfill realization rows from latest SAP receive dates (does not touch planning columns on trucking_operations).
WITH latest_sap AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')))
    spd.contract_number,
    spd.sto_number,
    COALESCE(
      spd.data->'raw'->>'Trucking Last Receive Date',
      spd.data->>'Trucking Last Receive Date',
      spd.data->'trucking'->0->'data'->>'trucking_last_receive_date'
    ) AS last_receive_raw,
    COALESCE(
      spd.data->'raw'->>'Trucking Start Receive Date',
      spd.data->>'Trucking Start Receive Date',
      spd.data->'trucking'->0->'data'->>'trucking_start_receive_date'
    ) AS start_receive_raw
  FROM sap_processed_data spd
  WHERE COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')) IS NOT NULL
  ORDER BY COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')),
    spd.created_at DESC NULLS LAST
),
parsed AS (
  SELECT
    contract_number,
    sto_number,
    CASE
      WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
      WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
      WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
      WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YYYY')
      ELSE NULL
    END AS last_receive_date,
    CASE
      WHEN start_receive_raw IS NULL OR length(trim(start_receive_raw)) < 6 THEN NULL
      WHEN trim(start_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(start_receive_raw)::date
      WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YY')
      WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YYYY')
      ELSE NULL
    END AS start_receive_date
  FROM latest_sap
)
INSERT INTO trucking_realizations (
  trucking_operation_id,
  realization_start_date,
  realization_end_date,
  source,
  sap_synced_at
)
SELECT DISTINCT ON (t.id)
  t.id,
  p.start_receive_date,
  p.last_receive_date,
  'sap_migrated',
  CURRENT_TIMESTAMP
FROM trucking_operations t
INNER JOIN contracts c ON t.contract_id = c.id
INNER JOIN parsed p ON (
  p.contract_number = c.contract_id
  OR (
    NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
    AND p.sto_number = NULLIF(TRIM(c.sto_number::text), '')
  )
)
WHERE (p.start_receive_date IS NOT NULL OR p.last_receive_date IS NOT NULL)
ORDER BY
  t.id,
  CASE
    WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
      AND p.sto_number = NULLIF(TRIM(c.sto_number::text), '')
    THEN 0
    ELSE 1
  END,
  p.last_receive_date DESC NULLS LAST
ON CONFLICT (trucking_operation_id) DO UPDATE SET
  realization_start_date = COALESCE(trucking_realizations.realization_start_date, EXCLUDED.realization_start_date),
  realization_end_date = COALESCE(trucking_realizations.realization_end_date, EXCLUDED.realization_end_date),
  source = CASE
    WHEN trucking_realizations.realization_start_date IS NULL
      AND trucking_realizations.realization_end_date IS NULL
    THEN EXCLUDED.source
    ELSE trucking_realizations.source
  END,
  sap_synced_at = COALESCE(trucking_realizations.sap_synced_at, EXCLUDED.sap_synced_at),
  updated_at = CURRENT_TIMESTAMP;
