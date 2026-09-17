#!/usr/bin/env bash
#
# Copies the execution-arm tracer into the backend container and runs it there.
#
#   bash /opt/klip/docs/scripts/diag-execution-arm-trace.sh 1004030633 1004031792 1004031937
#
set -u
[ "$#" -gt 0 ] || { echo "usage: $0 <contract_id> [contract_id ...]"; exit 1; }
cd /opt/klip || exit 1
CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-execution-arm-trace.js "$CID:/app/diag-execution-arm-trace.js" >/dev/null
docker compose exec -T backend node /app/diag-execution-arm-trace.js "$@"
