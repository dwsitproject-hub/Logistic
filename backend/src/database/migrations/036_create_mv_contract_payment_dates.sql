-- Materialized view for latest contract payment dates (Finance performance)
-- Safe-ish to re-run: drops and recreates the MV.

DROP MATERIALIZED VIEW IF EXISTS mv_contract_payment_dates;

CREATE MATERIALIZED VIEW mv_contract_payment_dates AS
SELECT DISTINCT ON (spd.contract_number)
  spd.contract_number AS contract_id,
  -- Parse dates from common raw formats; fall back to NULL when unparseable.
  (CASE
    WHEN raw_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN raw_due::date
    WHEN raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(raw_due, 'MM/DD/YY')
    WHEN raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(raw_due, 'MM/DD/YYYY')
    ELSE NULL
  END) AS due_date_payment,
  (CASE
    WHEN raw_dp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN raw_dp::date
    WHEN raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(raw_dp, 'MM/DD/YY')
    WHEN raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(raw_dp, 'MM/DD/YYYY')
    ELSE NULL
  END) AS dp_date,
  (CASE
    WHEN raw_payoff ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN raw_payoff::date
    WHEN raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(raw_payoff, 'MM/DD/YY')
    WHEN raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(raw_payoff, 'MM/DD/YYYY')
    ELSE NULL
  END) AS payoff_date,
  (CASE WHEN raw_dp_dev ~ '^-?[0-9]+$' THEN raw_dp_dev::int ELSE NULL END) AS dp_date_deviation_days,
  (CASE WHEN raw_payoff_dev ~ '^-?[0-9]+$' THEN raw_payoff_dev::int ELSE NULL END) AS payoff_date_deviation_days,
  spd.created_at AS source_created_at
FROM (
  SELECT
    spd.*,
    trim(COALESCE(
      NULLIF(trim(spd.data->'payment'->>'due_date_payment'), ''),
      NULLIF(trim(spd.data->'raw'->>'Due Date Payment'), '')
    )) AS raw_due,
    trim(COALESCE(
      NULLIF(trim(spd.data->'payment'->>'dp_date'), ''),
      NULLIF(trim(spd.data->'raw'->>'DP Date'), '')
    )) AS raw_dp,
    trim(COALESCE(
      NULLIF(trim(spd.data->'payment'->>'payoff_date'), ''),
      NULLIF(trim(spd.data->'raw'->>'Payoff Date'), '')
    )) AS raw_payoff,
    trim(COALESCE(
      NULLIF(trim(spd.data->'payment'->>'dp_date_deviation_days'), ''),
      NULLIF(trim(spd.data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), ''),
      NULLIF(trim(spd.data->'raw'->>'DP Date - Due Date'), '')
    )) AS raw_dp_dev,
    trim(COALESCE(
      NULLIF(trim(spd.data->'payment'->>'payoff_date_deviation_days'), ''),
      NULLIF(trim(spd.data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), ''),
      NULLIF(trim(spd.data->'raw'->>'Payoff Date - Due Date'), '')
    )) AS raw_payoff_dev
  FROM sap_processed_data spd
  WHERE spd.contract_number IS NOT NULL AND trim(spd.contract_number) <> ''
) spd
ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and speeds joins
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_contract_payment_dates_contract_id
  ON mv_contract_payment_dates (contract_id);

CREATE INDEX IF NOT EXISTS idx_mv_contract_payment_dates_due_date
  ON mv_contract_payment_dates (due_date_payment);

