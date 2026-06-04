-- =============================================================================
-- KLIP: Reset transactional / test data
-- =============================================================================
-- Use on DEV or STAGING to get a clean slate for QA. Always BACK UP first.
--
-- KEEPS (not truncated):
--   - users, roles, permissions, role_permissions
--   - suppliers, products (master)
--   - sap_field_mappings, data_validation_rules (SAP UI/config)
--   - vessel_master, master_vessels, master_loading_ports (master)
--   - schema_migrations (never touch)
--
-- REMOVES:
--   - Full SAP import pipeline (imports, raw, processed, user_data_inputs)
--   - contracts and all rows that reference them (shipments, trucking, ports,
--     payments, documents, quality surveys, etc.)
--   - audit_logs, ai_insights, alerts, dashboard_ai_insights cache, remarks
--   - user_sto_contract_assignments (if table exists)
--
-- OPTIONAL (commented): companies / company_notes — uncomment if you want
-- Customer 360 data cleared too.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1) SAP data pipeline (CASCADE clears sap_raw_data, sap_processed_data,
--    user_data_inputs, etc.)
-- ---------------------------------------------------------------------------
TRUNCATE TABLE sap_data_imports CASCADE;

-- ---------------------------------------------------------------------------
-- 2) Contracts and all dependent operational data (CASCADE)
-- ---------------------------------------------------------------------------
TRUNCATE TABLE contracts CASCADE;

-- ---------------------------------------------------------------------------
-- 3) Logs, AI cache, free-form remarks (not always FK-linked to contracts)
-- ---------------------------------------------------------------------------
TRUNCATE TABLE audit_logs RESTART IDENTITY;
TRUNCATE TABLE ai_insights RESTART IDENTITY;
TRUNCATE TABLE alerts RESTART IDENTITY;
TRUNCATE TABLE remarks RESTART IDENTITY;

-- dashboard_ai_insights exists only on newer schema versions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dashboard_ai_insights'
  ) THEN
    TRUNCATE TABLE dashboard_ai_insights RESTART IDENTITY;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) STO assignment overrides (created at runtime; no FK to contracts)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_sto_contract_assignments'
  ) THEN
    TRUNCATE TABLE user_sto_contract_assignments RESTART IDENTITY;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- OPTIONAL: Customer 360 — uncomment to also clear companies + notes
-- ---------------------------------------------------------------------------
-- TRUNCATE TABLE company_notes RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE companies RESTART IDENTITY CASCADE;

COMMIT;

-- Success marker (psql will show this)
SELECT 'reset-test-data: completed OK' AS status;
