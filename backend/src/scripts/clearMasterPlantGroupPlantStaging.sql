-- KLIP staging — clear all group_plant values (keep master_plants rows).
-- After this, upload Excel from Master Plant UI to fill group_plant via bulk upsert.
--
-- Run on staging backend host (/opt/klip):
--   docker compose -f docker-compose.backend.yml exec postgres \
--     psql -U postgres -d klip_db -f - < backend/src/scripts/clearMasterPlantGroupPlantStaging.sql
--
-- Or one-liner:
--   docker compose -f docker-compose.backend.yml exec postgres \
--     psql -U postgres -d klip_db -c "UPDATE master_plants SET group_plant = NULL, updated_at = CURRENT_TIMESTAMP;"

BEGIN;

SELECT COUNT(*)::int AS total_rows FROM master_plants;

SELECT COUNT(*)::int AS rows_with_group_plant
FROM master_plants
WHERE group_plant IS NOT NULL AND NULLIF(TRIM(group_plant), '') IS NOT NULL;

UPDATE master_plants
SET group_plant = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE group_plant IS NOT NULL
   OR NULLIF(TRIM(group_plant), '') IS NOT NULL;

SELECT COUNT(*)::int AS rows_with_group_plant_after
FROM master_plants
WHERE group_plant IS NOT NULL AND NULLIF(TRIM(group_plant), '') IS NOT NULL;

COMMIT;
