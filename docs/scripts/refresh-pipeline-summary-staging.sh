#!/usr/bin/env bash
# Rebuild pipeline daily summary tables (Shipments Section 1 Planned–Cancelled cards).
# Run after restoring shipments from backup or if status cards show 0 while list has rows.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/refresh-pipeline-summary-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.backend.yml)

# shellcheck source=docs/scripts/lib/refresh-pipeline-summary-staging.sh
source "$ROOT/docs/scripts/lib/refresh-pipeline-summary-staging.sh"

echo "=== KLIP pipeline daily summary refresh (SIT) ==="
refresh_pipeline_summary_staging
echo ""
print_shipment_pipeline_summary_counts_staging
print_trucking_pipeline_summary_counts_staging
echo ""
echo "Verify: http://8.215.6.189/shipments Section 1 (Ctrl+Shift+R)"
echo "Verify: http://8.215.6.189/trucking Section 1 (Ctrl+Shift+R)"
