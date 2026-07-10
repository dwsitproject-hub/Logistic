#!/usr/bin/env bash
# Run on staging BACKEND host (172.28.92.57) after: cd /opt/klip
# Exports master_plants.group_plant to CSV on stdout (redirect to file).
#
#   bash docs/scripts/export-master-plant-group-staging.sh > /tmp/master-plant-group-staging.csv
#   wc -l /tmp/master-plant-group-staging.csv
#
set -euo pipefail

cd /opt/klip

docker compose -f docker-compose.backend.yml exec -T postgres psql -U postgres -d klip_db --csv -c "
SELECT
  company_name,
  plant_code,
  TRIM(group_plant) AS group_plant
FROM master_plants
WHERE group_plant IS NOT NULL
  AND NULLIF(TRIM(group_plant), '') IS NOT NULL
ORDER BY company_name, plant_code
"
