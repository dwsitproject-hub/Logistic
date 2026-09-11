#!/usr/bin/env bash
# Set DB_USER / DB_PASSWORD in /opt/klip/.env - but only after proving they work.
#
#   bash docs/scripts/prod-set-db-credentials.sh
#
# Why a script and not a pasted block: an interactive `read` cannot be pasted into a terminal.
# The paste itself becomes stdin, so `read` swallows the next line of the block as its answer.
# Run from a file and the prompt reads the keyboard as intended.
#
# Order matters here: the connection is tested FIRST and .env is written only on success, so a
# wrong password is never persisted - and a half-written .env cannot send the backend at the
# wrong database.

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE - run prod-bootstrap-dirs.sh first" >&2; exit 1; }

# Read the non-secret settings from the existing file so this script changes only the credentials.
val() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

DB_HOST_CUR="$(val DB_HOST)"
DB_PORT_CUR="$(val DB_PORT)"
DB_NAME_CUR="$(val DB_NAME)"
JWT_CUR="$(val JWT_SECRET)"
SESS_CUR="$(val SESSION_SECRET)"
BE_PORT_CUR="$(val BACKEND_PORT)"
USER_CUR="$(val DB_USER)"

DB_HOST_CUR="${DB_HOST_CUR:-pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com}"
DB_PORT_CUR="${DB_PORT_CUR:-5432}"
DB_NAME_CUR="${DB_NAME_CUR:-klip_db}"
BE_PORT_CUR="${BE_PORT_CUR:-5001}"

echo "target : $DB_HOST_CUR:$DB_PORT_CUR/$DB_NAME_CUR"
echo

read -rp "DB_USER [${USER_CUR:-postgres}]: " U_IN
U_IN="${U_IN:-${USER_CUR:-postgres}}"

# -s so it is not echoed, and it never reaches the shell history because this is a script.
read -rsp "DB_PASSWORD for $U_IN: " P_IN
echo
[ -n "$P_IN" ] || { echo "empty password - aborted, $ENV_FILE unchanged" >&2; exit 1; }

echo
echo "--- testing connection (nothing is written yet) ---"
if docker run --rm -e PGPASSWORD="$P_IN" "$PG_IMAGE" \
     psql -h "$DB_HOST_CUR" -p "$DB_PORT_CUR" -U "$U_IN" -d "$DB_NAME_CUR" \
     -c 'SELECT current_database(), current_user, version();' \
     -c "SELECT count(*) AS existing_tables FROM information_schema.tables WHERE table_schema='public';"
then
  : # fall through to writing
else
  echo
  echo ">>> FAILED - $ENV_FILE left exactly as it was."
  echo "    If the password is certainly right, the user name is the next suspect: an Aliyun RDS"
  echo "    superuser is often not called 'postgres'. Whoever created klip_db knows which it is."
  exit 1
fi

# Regenerate the secrets only if absent, so re-running this does not invalidate live sessions.
if [ -z "$JWT_CUR" ]; then JWT_CUR="$(openssl rand -base64 48 | tr -d '\n')"; echo "   JWT_SECRET generated"; fi
if [ -z "$SESS_CUR" ]; then SESS_CUR="$(openssl rand -base64 48 | tr -d '\n')"; echo "   SESSION_SECRET generated"; fi

TMP="$(mktemp)"
chmod 600 "$TMP"
{
  printf '%s\n' "DB_HOST=$DB_HOST_CUR"
  printf '%s\n' "DB_PORT=$DB_PORT_CUR"
  printf '%s\n' "DB_NAME=$DB_NAME_CUR"
  printf '%s\n' "DB_USER=$U_IN"
  printf '%s\n' "DB_PASSWORD=$P_IN"
  printf '%s\n' 'KLIP_FAIL_ON_LOCAL_DB=true'
  printf '%s\n' "BACKEND_PORT=$BE_PORT_CUR"
  printf '%s\n' "JWT_SECRET=$JWT_CUR"
  printf '%s\n' "SESSION_SECRET=$SESS_CUR"
} > "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo ">>> OK - $ENV_FILE written"
sed 's/^\(DB_PASSWORD\|JWT_SECRET\|SESSION_SECRET\)=.*/\1=<set>/' "$ENV_FILE"

case "$P_IN" in
  *\$*) echo
        echo "NOTE: the password contains '\$'. Docker Compose interpolates \${...} in .env, so"
        echo "      double it to \$\$ in $ENV_FILE or Compose will pass the wrong value." ;;
esac
