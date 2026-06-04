-- KLIP staging — clear all Master Plant rows before a fresh upload.
-- Safe: master_plants has no foreign keys from other tables (lookup only).
--
-- Run on staging DB (backend server), e.g.:
--   psql -h localhost -U postgres -d klip_db -f src/scripts/clearMasterPlantsStaging.sql
--
-- Or from repo root on staging host (Postgres published on 127.0.0.1:5433):
--   docker compose -f docker-compose.backend.yml exec postgres \
--     psql -U postgres -d klip_db -c "TRUNCATE TABLE master_plants;"

BEGIN;

SELECT COUNT(*) AS master_plants_before FROM master_plants;

SELECT company_name, plant_code, plant_name, group_plant, updated_at
FROM master_plants
ORDER BY company_name, plant_code
LIMIT 25;

TRUNCATE TABLE master_plants;

SELECT COUNT(*) AS master_plants_after FROM master_plants;

COMMIT;
