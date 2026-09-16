#!/usr/bin/env bash
#
# Copies the per-contract Shipments OS lister into the backend container and runs it there.
# The production image ships only dist/, so the script cannot be run with ts-node from src.
#
#   bash /opt/klip/docs/scripts/diag-shipments-os-contracts.sh CPO BONTANG FOB 2026-01-01 2026-12-31
#
set -u
cd /opt/klip || exit 1
CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-shipments-os-contracts.js "$CID:/app/diag-shipments-os-contracts.js" >/dev/null
docker compose exec -T backend node /app/diag-shipments-os-contracts.js "${1:-CPO}" "${2:-BONTANG}" "${3:-FOB}" "${4:-2026-01-01}" "${5:-2026-12-31}"
