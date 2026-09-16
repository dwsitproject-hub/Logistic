#!/usr/bin/env bash
#
# Copies the "which Shipments gate rejects this contract" explainer into the backend container and
# runs it there. The production image ships only dist/, so it cannot run from src with ts-node.
#
#   bash /opt/klip/docs/scripts/diag-why-no-shipments-arm.sh 1004030633 1004031792 1004031937
#
set -u
[ "$#" -gt 0 ] || { echo "usage: $0 <contract_id> [contract_id ...]"; exit 1; }
cd /opt/klip || exit 1
CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-why-no-shipments-arm.js "$CID:/app/diag-why-no-shipments-arm.js" >/dev/null
docker compose exec -T backend node /app/diag-why-no-shipments-arm.js "$@"
