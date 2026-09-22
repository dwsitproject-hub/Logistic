#!/usr/bin/env bash
# Restore a production dump into its OWN local Postgres, beside the dev one.
#
#   bash docs/scripts/local-restore-prod-dump.sh klip-prod-20260922-1030.dump
#   bash docs/scripts/local-restore-prod-dump.sh klip-prod-20260922-1030.dump --replace
#
# WHY A SEPARATE SERVER, not just a separate database. Production runs PostgreSQL 18.4 and the dev
# container here runs 14.23; a custom-format dump only restores forward, so 18 -> 14 cannot work at
# all. Standing up an 18 container is therefore necessary, and it has a second benefit worth as
# much: the dev database another agent is working against is not merely untouched, it is not even
# reachable from this operation.
#
# The copy listens on 127.0.0.1 only and uses trust auth, so no password for production data is
# created, stored or typed anywhere. It holds real commercial data - stop it when the analysis is
# done (docker rm -f klip-prod-copy-pg).
#
# Point a diagnostic at the copy with env overrides, leaving backend/.env alone:
#
#   cd backend && DB_HOST=127.0.0.1 DB_PORT=5434 DB_NAME=klip_prod_copy DB_USER=klip \
#     node ../docs/scripts/diag-os-per-contract.cjs CPO BONTANG
#
# (dotenv does not overwrite variables already in the environment - verified, connection.ts calls
# dotenv.config() with no override - so the overrides win. Check the host the connection logs on
# startup before trusting any number.)
set -euo pipefail

# Git Bash on Windows rewrites anything that looks like a Unix path before it reaches docker, so
# "/tmp/x.dump" arrived at pg_restore as "C:/Users/.../Temp/x.dump" and the restore failed while
# every step before it reported success. These switches turn that translation off - which then
# breaks the HOST side of `docker cp`, because "/d/Project/x.dump" is exactly the form that needed
# translating. So the container paths stay literal and the host path is converted explicitly below.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

DUMP_FILE="${1:-}"
REPLACE="${2:-}"
[ -n "$DUMP_FILE" ] || { echo "usage: $0 <dump-file> [--replace]"; exit 1; }
[ -f "$DUMP_FILE" ] || { echo "no such file: $DUMP_FILE"; exit 1; }

CONTAINER="${KLIP_PROD_COPY_CONTAINER:-klip-prod-copy-pg}"
IMAGE="${KLIP_PROD_COPY_IMAGE:-postgres:18}"
PORT="${KLIP_PROD_COPY_PORT:-5434}"
DB_NAME="${KLIP_PROD_COPY_DB:-klip_prod_copy}"
DB_USER="${KLIP_PROD_COPY_USER:-klip}"

# The dev container must never be the target. Named explicitly so a typo in the env cannot point
# this at it.
DEV_CONTAINER="${KLIP_PG_CONTAINER:-klip-postgres}"
if [ "$CONTAINER" = "$DEV_CONTAINER" ]; then
  echo "REFUSING: the target container is the DEV one ($DEV_CONTAINER)."
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if [ "$REPLACE" != "--replace" ]; then
    echo "container '$CONTAINER' already exists."
    echo "Re-run with --replace to destroy and rebuild it. Nothing has been changed."
    exit 1
  fi
  echo "removing the previous copy container"
  docker rm -f "$CONTAINER" >/dev/null
fi

echo "starting $IMAGE as '$CONTAINER' on 127.0.0.1:${PORT} (trust auth, localhost only)"
docker run -d --name "$CONTAINER" \
  -p "127.0.0.1:${PORT}:5432" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" >/dev/null

printf 'waiting for it to accept connections'
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo " - ready"
    break
  fi
  printf '.'
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 || {
  echo; echo "it never became ready - check 'docker logs $CONTAINER'"; exit 1; }

BASE="$(basename "$DUMP_FILE")"
# cygpath exists only on Git Bash / MSYS; elsewhere the path is already what docker expects.
HOST_DUMP="$(cygpath -w "$DUMP_FILE" 2>/dev/null || echo "$DUMP_FILE")"
echo "copying ${BASE} in"
docker cp "$HOST_DUMP" "${CONTAINER}:/tmp/${BASE}"

# Errors are not fatal on purpose: a production dump routinely references roles and extensions this
# fresh cluster lacks, and those failures are noise. The row counts below are what says whether the
# restore actually worked - read them, do not assume.
echo "restoring - role and extension warnings are expected"
docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
  -j 4 --no-owner --no-privileges "/tmp/${BASE}" || true
docker exec "$CONTAINER" rm -f "/tmp/${BASE}"

echo
echo "row counts in the copy - compare with production before trusting a measurement:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 'contracts' AS table_name, COUNT(*) FROM contracts
  UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
  UNION ALL SELECT 'contract_stos', COUNT(*) FROM contract_stos
  UNION ALL SELECT 'sap_processed_data', COUNT(*) FROM sap_processed_data
  UNION ALL SELECT 'contract_qty_move_snapshot', COUNT(*) FROM contract_qty_move_snapshot
  UNION ALL SELECT 'contract_latest_spd_snapshot', COUNT(*) FROM contract_latest_spd_snapshot;"

echo
echo "run a diagnostic against the copy (backend/.env is not modified):"
echo "  cd backend && DB_HOST=127.0.0.1 DB_PORT=${PORT} DB_NAME=${DB_NAME} DB_USER=${DB_USER} \\"
echo "    node ../docs/scripts/diag-os-per-contract.cjs CPO BONTANG"
echo
echo "when the analysis is done:  docker rm -f ${CONTAINER}"
