#!/usr/bin/env bash
#
# Set the Jetty Planning System variables in /opt/klip/.env — SIT only.
#
#   cd /opt/klip && bash docs/scripts/setup-jps-env.sh
#
# WHY A SCRIPT AND NOT A cat >> .env. Three things go wrong when this is typed by hand, and all
# three have happened on this project:
#
#   1. The API key lands in ~/.bash_history and in whatever the terminal is logged to. It is read
#      here with `read -rsp`, so it is never echoed, never an argument, and never printed back.
#   2. Re-running appends a second copy of every line. Docker Compose takes the LAST value, so the
#      file still works while saying two different things - this rewrites in place instead.
#   3. A command meant for SIT gets pasted into the production shell. This one refuses unless the
#      environment says SIT, and makes you type the name to confirm.
#
# It writes .env and nothing else. Deploy afterwards; the script does not restart anything.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
JPS_BASE_DEFAULT="http://172.28.92.56:3080/api/v1/integrations"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run this from the deploy directory (usually /opt/klip)." >&2
  exit 1
fi

read_env() { grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }

KLIP_ENV_VALUE="$(read_env KLIP_ENV)"
DB_HOST_VALUE="$(read_env DB_HOST)"

echo
echo "  file        : $(readlink -f "$ENV_FILE")"
echo "  host        : $(hostname)"
echo "  KLIP_ENV    : ${KLIP_ENV_VALUE:-(not set)}"
echo "  DB_HOST     : ${DB_HOST_VALUE:-(not set)}"
echo

# The guard is deliberately a typed answer rather than a y/n: a reflexive "y" is exactly how a
# command intended for SIT reaches production.
if [[ "${JPS_SETUP_FORCE:-}" != "1" ]]; then
  printf '  This enables an integration that POSTS to an external partner system.\n'
  printf '  Type the environment name to continue (expected: sit): '
  read -r CONFIRM
  if [[ "${CONFIRM,,}" != "sit" ]]; then
    echo "  aborted - nothing written" >&2
    exit 1
  fi
  if [[ -n "$KLIP_ENV_VALUE" && "${KLIP_ENV_VALUE,,}" != "sit" ]]; then
    echo "  ERROR: KLIP_ENV is '${KLIP_ENV_VALUE}', not 'sit'. Re-run with JPS_SETUP_FORCE=1 only" >&2
    echo "         if you are certain this host is SIT." >&2
    exit 1
  fi
fi

printf '  JPS_API_KEY (input hidden, leave empty to keep the current value): '
read -rs JPS_KEY
echo

EXISTING_KEY="$(read_env JPS_API_KEY)"
if [[ -z "$JPS_KEY" ]]; then
  if [[ -z "$EXISTING_KEY" ]]; then
    echo "  ERROR: no key given and none stored - nothing written" >&2
    exit 1
  fi
  JPS_KEY="$EXISTING_KEY"
  echo "  keeping the stored key"
fi

BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"

# Rewrite in place: drop any existing JPS lines, then append one block. Re-running is then a no-op
# rather than a second copy.
set_var() {
  local key="$1" value="$2"
  grep -vE "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

set_var JPS_ENABLED true
set_var JPS_API_BASE_URL "${JPS_API_BASE_URL:-$JPS_BASE_DEFAULT}"
set_var JPS_API_KEY "$JPS_KEY"
set_var JPS_PORT_ID "${JPS_PORT_ID:-1}"
set_var JPS_REGION_SITE "${JPS_REGION_SITE:-BONTANG}"
# The frontend flag is separate on purpose: JPS_ENABLED only means anything alongside a base URL
# and a key, and neither may reach the browser. This one only decides whether the two Jetty columns
# appear on the Shipments table.
set_var NEXT_PUBLIC_JPS_ENABLED true

chmod 600 "$ENV_FILE" 2>/dev/null || true

echo
echo "  written. backup: $BACKUP"
echo
grep -E '^(JPS_|NEXT_PUBLIC_JPS_)' "$ENV_FILE" | sed -E 's/^(JPS_API_KEY=).*/\1(hidden)/' | sed 's/^/    /'
echo
cat <<'NEXT'
  Next:

    docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml up -d --build
    docker compose -f docker-compose.frontend.yml up -d --build

  Then confirm it is on - this must say "scheduled", not "disabled":

    docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml logs --tail=100 backend | grep -i "JPS sync cron"

  To switch it off again, set JPS_ENABLED=false and redeploy the backend. Nothing already sent to
  JPS is withdrawn by that - the partner API has no cancel endpoint.
NEXT
