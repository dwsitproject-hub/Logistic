#!/usr/bin/env bash
# Restore the phase-1 master dump into a fresh production database.
#
#   bash docs/scripts/prod-restore-master.sh /opt/klip/backups/klip-master-<ts>.dump
#
# Run on the production BACKEND host, after the backend has started once (the schema comes from
# the migrations, not from the dump - the dump is --data-only).
#
# Handles two things a plain pg_restore cannot.
#
# 1. docker-entrypoint.sh seeds five accounts on every container start, and staging has the same
#    usernames, so restoring `users` would fail on the unique constraint. Those five rows are
#    removed first - identified narrowly, by username AND the seed's own @klip.com email, so a
#    real account that happens to be called "admin" is left alone.
#
# 2. A --data-only restore is not FK-safe, and --disable-triggers needs superuser rights that a
#    managed database does not grant. Tables are restored one at a time, parents first.

set -uo pipefail

DUMP="${1:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -n "$DUMP" ] || { echo "usage: bash prod-restore-master.sh <dump-file>" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

# Read .env by parsing, never by sourcing.
#
# A .env is not a shell script. Docker Compose accepts unquoted spaces in values, so a legitimate
# line like `OIDC_SCOPES=openid email profile` becomes, under `source`, an assignment followed by
# a command named `email` - which aborted this script on the staging host with
# "email: command not found". Parsing takes the literal text after the first '=' and interprets
# nothing.
envval() {
  [ -f "$ENV_FILE" ] || return 0
  grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-
}

DB_HOST="$(envval DB_HOST)"
DB_PORT="$(envval DB_PORT)"
DB_NAME="$(envval DB_NAME)"
DB_USER="$(envval DB_USER)"
DB_PASSWORD="$(envval DB_PASSWORD)"
: "${DB_HOST:?DB_HOST not found in $ENV_FILE}"
: "${DB_NAME:?DB_NAME not found}"
: "${DB_USER:?DB_USER not found}"
: "${DB_PASSWORD:?DB_PASSWORD not found}"
DB_PORT="${DB_PORT:-5432}"

DUMP_DIR="$(cd "$(dirname "$DUMP")" && pwd)"
DUMP_FILE="$(basename "$DUMP")"

psql_run() {
  docker run --rm -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}
psql_val() {
  docker run --rm -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

echo "=== target: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== dump  : $DUMP ($(du -h "$DUMP" | cut -f1))"
echo

echo "--- users before ---"
psql_run -c 'SELECT username, email, role FROM users ORDER BY created_at;'

# The seeded rows, named exactly. `email LIKE '%@klip.com'` is the discriminator: a real account
# created later would not carry the seed's placeholder address, so this cannot delete live data.
SEED_COUNT="$(psql_val "SELECT count(*) FROM users WHERE username IN ('admin','trading','logistics','finance','management') AND email LIKE '%@klip.com'")"
TOTAL_USERS="$(psql_val 'SELECT count(*) FROM users')"

echo
echo "seeded rows matching the entrypoint seed : $SEED_COUNT"
echo "total rows in users                      : $TOTAL_USERS"

if [ "$SEED_COUNT" != "$TOTAL_USERS" ]; then
  echo
  echo ">>> STOP: users holds rows this script did not put there ($TOTAL_USERS total, $SEED_COUNT"
  echo "    look like seeds). Someone has created real accounts, or a restore already ran."
  echo "    Deleting blindly could destroy them. Inspect the table above and decide by hand."
  exit 1
fi

if [ "$SEED_COUNT" -gt 0 ]; then
  echo
  echo "--- removing the $SEED_COUNT seeded rows so the restore can insert staging's users ---"
  echo "    (the entrypoint re-seeds on every start, but with ON CONFLICT (username) DO NOTHING,"
  echo "     so it will not overwrite what this restore brings in)"
  psql_run -c "DELETE FROM users WHERE username IN ('admin','trading','logistics','finance','management') AND email LIKE '%@klip.com';"
fi

# Restore order, and why it is explicit rather than left to pg_restore.
#
# A --data-only restore is not guaranteed to be FK-safe, and here it demonstrably is not:
# pg_restore works through the TOC roughly alphabetically, which puts
# master_vessel_code_aliases before master_vessels and user_plants before users. The usual answer
# is --disable-triggers, but that needs real superuser rights and the Aliyun RDS `postgres`
# account does not have them - it fails with
#   permission denied: "RI_ConstraintTrigger_..." is a system trigger
#
# So the tables go in one at a time, parents first. This needs no special privileges at all.
#
# The FK graph among these tables (read from the schema, not assumed):
#   master_vessel_code_aliases -> master_vessels
#   user_plants                -> users, master_plants
#   user_products              -> users, products
#   loading_ports, surveyors   -> shipments   (both empty; see the note below)
RESTORE_ORDER=(
  users
  products
  suppliers
  supplier_groups
  master_plants
  master_vessels
  master_loading_ports
  surveyors
  loading_ports
  master_vessel_code_aliases
  user_plants
  user_products
)

# Each table is inserted without ON CONFLICT, so a second run would duplicate rows. Refuse when
# anything is already populated rather than silently doubling the master data.
echo
echo "--- checking the target tables are empty ---"
NOT_EMPTY=""
for t in "${RESTORE_ORDER[@]}"; do
  exists="$(psql_val "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1")"
  [ "$exists" = "1" ] || continue
  n="$(psql_val "SELECT count(*) FROM \"$t\"")"
  [ "${n:-0}" -eq 0 ] || NOT_EMPTY="$NOT_EMPTY $t($n)"
done

if [ -n "$NOT_EMPTY" ]; then
  echo
  echo ">>> STOP: these tables already hold rows:$NOT_EMPTY"
  echo "    This restore inserts without ON CONFLICT, so running it now would duplicate the"
  echo "    master data. If a previous attempt loaded some tables, empty those and retry."
  exit 1
fi
echo "    all empty - proceeding"

echo
echo "--- restoring, parents first ---"
FAILED=""
for t in "${RESTORE_ORDER[@]}"; do
  exists="$(psql_val "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1")"
  [ "$exists" = "1" ] || continue
  # --single-transaction per table: a table either loads completely or not at all.
  if docker run --rm -e PGPASSWORD="$DB_PASSWORD" -v "$DUMP_DIR:/dump:ro" "$PG_IMAGE" \
       pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
       --data-only --no-owner --single-transaction \
       -t "$t" "/dump/$DUMP_FILE" 2>/tmp/restore_err_$$
  then
    printf '  %-30s %s rows\n' "$t" "$(psql_val "SELECT count(*) FROM \"$t\"")"
  else
    printf '  %-30s FAILED\n' "$t"
    sed 's/^/      /' /tmp/restore_err_$$
    FAILED="$FAILED $t"
  fi
  rm -f /tmp/restore_err_$$
done

if [ -n "$FAILED" ]; then
  echo
  echo ">>> Tables that failed:$FAILED"
  echo "    Tables listed with a row count above DID commit. Empty those and the failed ones,"
  echo "    then retry, rather than re-running on a half-loaded database."
  exit 1
fi

echo "=== row counts after restore ==="
for t in suppliers supplier_groups products surveyors loading_ports \
         master_plants master_vessels master_loading_ports master_vessel_code_aliases \
         users user_plants user_products; do
  exists="$(psql_val "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1")"
  if [ "$exists" = "1" ]; then
    printf '  %-30s %s\n' "$t" "$(psql_val "SELECT count(*) FROM \"$t\"")"
  fi
done

echo
echo "--- users after ---"
psql_run -c 'SELECT username, email, role FROM users ORDER BY username;'

echo
echo ">>> Done. Two things follow from bringing staging accounts across:"
echo "    1. Their password hashes came with them, so any weak staging password is now a"
echo "       production password. Rotate before the site is reachable."
echo "    2. If staging had no 'admin', the seeded one is gone and the next container restart"
echo "       will recreate it with the password that is in the repository."
