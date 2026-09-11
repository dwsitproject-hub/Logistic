#!/usr/bin/env bash
# Restore the phase-1 master dump into a fresh production database.
#
#   bash docs/scripts/prod-restore-master.sh /opt/klip/backups/klip-master-<ts>.dump
#
# Run on the production BACKEND host, after the backend has started once (the schema comes from
# the migrations, not from the dump - the dump is --data-only).
#
# Handles the one collision this restore always hits: docker-entrypoint.sh seeds five accounts on
# every container start, and staging has the same usernames, so restoring `users` would fail on
# the unique constraint. Those five rows are removed first - identified narrowly, by username AND
# the seed's own @klip.com email, so a real account that happens to be called "admin" is left
# alone.

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

echo
echo "--- restoring (single transaction: all of it, or none) ---"
# --single-transaction so a failure halfway leaves the database exactly as it was.
# --disable-triggers because a --data-only restore does not guarantee FK-safe table order.
docker run --rm -e PGPASSWORD="$DB_PASSWORD" -v "$DUMP_DIR:/dump:ro" "$PG_IMAGE" \
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --data-only --no-owner --disable-triggers --single-transaction \
  "/dump/$DUMP_FILE"
RC=$?

echo
if [ $RC -ne 0 ]; then
  echo ">>> RESTORE FAILED (exit $RC). Because it ran in one transaction, nothing was committed -"
  echo "    except the DELETE above, which did commit. Re-run the backend container to re-seed the"
  echo "    five accounts if you need to log in before retrying."
  exit $RC
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
