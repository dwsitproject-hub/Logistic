#!/usr/bin/env bash
# KLIP: reset transactional test data (see reset-test-data.sql)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="${ROOT}/scripts/reset-test-data.sql"

USE_DOCKER="${USE_DOCKER:-1}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-klip-postgres-dev}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGDATABASE="${PGDATABASE:-klip_db}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres123}"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "SQL file not found: $SQL_FILE" >&2
  exit 1
fi

echo "KLIP reset-test-data"
echo "SQL file: $SQL_FILE"

if [[ "$USE_DOCKER" == "1" ]]; then
  echo "Using Docker container: $DOCKER_CONTAINER"
  if ! docker ps --filter "name=${DOCKER_CONTAINER}" --format '{{.Names}}' | grep -q .; then
    echo "Container '${DOCKER_CONTAINER}' is not running." >&2
    exit 1
  fi
  docker exec -i "$DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 < "$SQL_FILE"
else
  echo "Using psql: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
fi

echo "Done."
