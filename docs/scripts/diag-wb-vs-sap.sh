#!/usr/bin/env bash
#
# Copies the WB-vs-SAP measurement into the backend container and runs it there.
#
#   bash /opt/klip/docs/scripts/diag-wb-vs-sap.sh
#
set -u
cd /opt/klip || exit 1
CID="$(docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml ps -q backend 2>/dev/null)"
[ -n "$CID" ] || CID="$(docker compose ps -q backend 2>/dev/null)"
[ -n "$CID" ] || { echo "backend container not found - run from the compose project directory"; exit 1; }
docker cp docs/scripts/diag-wb-vs-sap.js "$CID:/app/diag-wb-vs-sap.js" >/dev/null
docker exec -i "$CID" node /app/diag-wb-vs-sap.js
