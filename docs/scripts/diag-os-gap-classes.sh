#!/usr/bin/env bash
#
# Copies the OS-gap class measurement into the backend container and runs it there.
# The production image ships only dist/, so it cannot be run with ts-node from src.
#
#   bash /opt/klip/docs/scripts/diag-os-gap-classes.sh [FROM] [TO]
#
set -u
cd /opt/klip || exit 1
CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-os-gap-classes.js "$CID:/app/diag-os-gap-classes.js" >/dev/null
docker compose exec -T backend node /app/diag-os-gap-classes.js "${1:-2026-01-01}" "${2:-2026-12-31}"
