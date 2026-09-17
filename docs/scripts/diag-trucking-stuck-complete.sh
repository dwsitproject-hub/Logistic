#!/usr/bin/env bash
#
# Copies the stuck-Completed measurement into the backend container and runs it there.
#
#   bash /opt/klip/docs/scripts/diag-trucking-stuck-complete.sh
#
set -u
cd /opt/klip || exit 1
CID="$(docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml ps -q backend 2>/dev/null)"
[ -n "$CID" ] || CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-trucking-stuck-complete.js "$CID:/app/diag-trucking-stuck-complete.js" >/dev/null
docker exec -i "$CID" node /app/diag-trucking-stuck-complete.js
