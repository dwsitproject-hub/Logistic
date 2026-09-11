#!/usr/bin/env bash
# Phase 1: dump MASTER/reference data only, for seeding a fresh production database.
#
# Transaction data is deliberately excluded - the intent is that contracts, shipments and
# trucking operations arrive from the SAP import on production, so that what the import produces
# can be judged on its own.
#
#   bash prod-dump-master.sh                      # writes /opt/klip/backups/klip-master-<ts>.dump
#   PGDUMP_IMAGE=postgres:18-alpine bash prod-dump-master.sh
#
# Reads connection settings from /opt/klip/.env (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD).
# Run it on the STAGING side, against the staging database - it only reads.

set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
# pg_dump refuses to dump a server newer than itself, and the SIT RDS is PG18. Override if the
# source server is a different major version.
PGDUMP_IMAGE="${PGDUMP_IMAGE:-postgres:18-alpine}"

if [ "$ENV_FILE" != "/dev/null" ]; then
  [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
  set -a; . "$ENV_FILE"; set +a
fi
: "${DB_HOST:?DB_HOST not set in $ENV_FILE}"
: "${DB_NAME:?DB_NAME not set}"
: "${DB_USER:?DB_USER not set}"
: "${DB_PASSWORD:?DB_PASSWORD not set}"
DB_PORT="${DB_PORT:-5432}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%F-%H%M)"
OUT="$OUT_DIR/klip-master-$STAMP.dump"

# Reference data: values the business maintains, not rows produced by day-to-day operations.
#
# `contracts` is NOT here on purpose. It looks master-like, but the SAP import creates and updates
# it (ON CONFLICT (contract_id) DO UPDATE in sapDataDistribution.service), so bringing it now
# would pre-empt the very thing this phase is meant to observe.
MASTER_TABLES=(
  suppliers
  supplier_groups
  products
  surveyors
  loading_ports
  master_plants
  master_vessels
  master_loading_ports
  master_vessel_code_aliases
)

# Accounts and their data scope. Without these nobody can log in with the right Region/Plant and
# Product restrictions, and the container's own seed would be the only accounts that exist -
# five of them with passwords that are in the repository.
USER_TABLES=(
  users
  user_plants
  user_products
)

psql_q() {
  docker run --rm -e PGPASSWORD="$DB_PASSWORD" "$PGDUMP_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

echo "=== running on: $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}')) ==="
echo "=== source    : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME ==="
echo "server version: $(psql_q 'SHOW server_version')"

PRESENT=()
echo
echo "=== tables ==="
for t in "${MASTER_TABLES[@]}" "${USER_TABLES[@]}"; do
  exists="$(psql_q "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1" || true)"
  if [ "$exists" = "1" ]; then
    n="$(psql_q "SELECT count(*) FROM \"$t\"" || echo '?')"
    printf '  + %-28s %s rows\n' "$t" "$n"
    PRESENT+=("$t")
  else
    printf '  - %-28s (absent, skipped)\n' "$t"
  fi
done

[ "${#PRESENT[@]}" -gt 0 ] || { echo "no tables found to dump" >&2; exit 1; }

# Refuse to dump a database that has no master data.
#
# This script takes its connection from /opt/klip/.env, and on the PRODUCTION host that file
# points at production - so running it there dumps the empty database you were about to seed.
# That happened on 2026-09-11 and produced a 6.2K file containing only the five seeded accounts.
# Nothing legitimate is ever dumped from an empty source, so refusing is always right.
MASTER_ROWS=0
for t in "${MASTER_TABLES[@]}"; do
  case " ${PRESENT[*]} " in
    *" $t "*) n="$(psql_q "SELECT count(*) FROM \"$t\"" || echo 0)"
              MASTER_ROWS=$(( MASTER_ROWS + ${n:-0} )) ;;
  esac
done

if [ "$MASTER_ROWS" -eq 0 ]; then
  echo
  echo ">>> STOP: every master table is empty at $DB_HOST/$DB_NAME."
  echo "    Nothing would be dumped. This is what happens when the script runs on the PRODUCTION"
  echo "    host, where /opt/klip/.env points at the production database."
  echo
  echo "    Run it on the STAGING host instead, where .env points at the SIT database."
  echo "    To dump a different source without moving hosts, override the connection:"
  echo "      DB_HOST=<sit-host> DB_NAME=<db> DB_USER=<user> DB_PASSWORD=<pw> \\"
  echo "        ENV_FILE=/dev/null bash $0"
  exit 1
fi
echo
echo "master rows found: $MASTER_ROWS (source looks populated)"


ARGS=()
for t in "${PRESENT[@]}"; do ARGS+=(-t "public.$t"); done

echo
echo "=== dumping to $OUT ==="
# Custom format (-Fc): restores selectively and in dependency order, unlike a plain SQL file.
docker run --rm -e PGPASSWORD="$DB_PASSWORD" -v "$OUT_DIR:/out" "$PGDUMP_IMAGE" \
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --data-only --no-owner --no-privileges -Fc \
  "${ARGS[@]}" -f "/out/$(basename "$OUT")"

ls -lh "$OUT"
echo
echo "Data-only on purpose: production builds its schema from the migrations, so the dump must"
echo "not carry DDL that could differ from the migration state."
echo
echo "Restore on production (schema must exist first - let the backend run its migrations once):"
echo "  docker run --rm -e PGPASSWORD=\"\$DB_PASSWORD\" -v $OUT_DIR:/out $PGDUMP_IMAGE \\"
echo "    pg_restore -h \$DB_HOST -p \$DB_PORT -U \$DB_USER -d \$DB_NAME \\"
echo "    --data-only --no-owner --disable-triggers /out/$(basename "$OUT")"
