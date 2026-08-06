#!/usr/bin/env bash
# Configure SMTP for Contract ETA / Missing Planning reminder on SIT backend, restart
# backend, verify env in container, and optionally send a test email.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/setup-sit-smtp-eta-reminder-staging.sh --apply
#   bash docs/scripts/setup-sit-smtp-eta-reminder-staging.sh --apply --smtp-password 'YOUR_PASSWORD'
#   bash docs/scripts/setup-sit-smtp-eta-reminder-staging.sh --apply --test-to ryan.pohan@energi-up.com
#
# Env vars (optional instead of flags):
#   KLIP_SMTP_PASSWORD, KLIP_SMTP_HOST, KLIP_SMTP_USER, KLIP_EMAIL_FROM
#
# Writes to BOTH /opt/klip/.env (compose substitution) and backend/.env (env_file).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
COMPOSE_FILE="docker-compose.backend.yml"
APPLY=false
SKIP_TEST=false
TEST_TO="ryan.pohan@energi-up.com"
RECIPIENTS_ONLY=true
SMTP_PASSWORD="${KLIP_SMTP_PASSWORD:-}"

DEFAULT_EMAIL_FROM="${KLIP_EMAIL_FROM:-noreply.sys@energi-up.com}"
DEFAULT_SMTP_HOST="${KLIP_SMTP_HOST:-mail.energi-up.com}"
DEFAULT_SMTP_PORT="${KLIP_SMTP_PORT:-587}"
DEFAULT_SMTP_USER="${KLIP_SMTP_USER:-noreply.sys@energi-up.com}"
DEFAULT_SMTP_SECURE="${KLIP_SMTP_SECURE:-false}"
DEFAULT_SMTP_REJECT="${KLIP_SMTP_REJECT_UNAUTHORIZED:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --skip-test) SKIP_TEST=true; shift ;;
    --test-to)
      if [[ -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "ERROR: --test-to requires an email address" >&2
        exit 1
      fi
      TEST_TO="$2"
      shift 2
      ;;
    --all-recipients) RECIPIENTS_ONLY=false; shift ;;
    --smtp-password)
      if [[ -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "ERROR: --smtp-password requires a value" >&2
        exit 1
      fi
      SMTP_PASSWORD="$2"
      shift 2
      ;;
    --smtp-host)
      DEFAULT_SMTP_HOST="$2"
      shift 2
      ;;
    --smtp-user)
      DEFAULT_SMTP_USER="$2"
      shift 2
      ;;
    --email-from)
      DEFAULT_EMAIL_FROM="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Use: --apply [--smtp-password PASS] [--test-to EMAIL] [--skip-test]" >&2
      exit 1
      ;;
  esac
done

ROOT_ENV="${APP_DIR}/.env"
BACKEND_ENV="${APP_DIR}/backend/.env"

escape_env_value() {
  local v="${1//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '"%s"' "$v"
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local raw_value="$3"
  local quoted
  quoted="$(escape_env_value "$raw_value")"

  touch "$file"
  chmod 600 "$file" 2>/dev/null || true

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      if [[ "$line" =~ ^${key}= ]]; then
        printf '%s=%s\n' "$key" "$quoted"
      else
        printf '%s\n' "$line"
      fi
    done < "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$quoted" >> "$file"
  fi
}

load_existing_smtp_password() {
  local file key val line
  for file in "$ROOT_ENV" "$BACKEND_ENV"; do
    [[ -f "$file" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ "$line" =~ ^SMTP_PASSWORD=(.*)$ ]] || continue
      val="${BASH_REMATCH[1]}"
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ -n "$val" && "$val" != "change-me" ]]; then
        SMTP_PASSWORD="$val"
        return 0
      fi
    done < "$file"
  done
  return 1
}

echo "==> KLIP SIT — SMTP setup for Contract ETA / Missing Planning reminder"
echo "    app dir: ${APP_DIR}"
echo "    root env: ${ROOT_ENV}"
echo "    backend env: ${BACKEND_ENV}"
echo

cd "$APP_DIR"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: ${COMPOSE_FILE} not found — run from ${APP_DIR}" >&2
  exit 1
fi

mkdir -p "$(dirname "$BACKEND_ENV")"
touch "$ROOT_ENV" "$BACKEND_ENV"
chmod 600 "$ROOT_ENV" "$BACKEND_ENV" 2>/dev/null || true

if [[ -z "$SMTP_PASSWORD" ]]; then
  load_existing_smtp_password || true
fi

if [[ -z "$SMTP_PASSWORD" ]]; then
  if [[ "$APPLY" != true ]]; then
    echo "NOTE: SMTP_PASSWORD not set — preview only. Pass --apply and you will be prompted,"
    echo "      or use --smtp-password / KLIP_SMTP_PASSWORD."
  elif [[ -t 0 ]]; then
    read -r -s -p "Enter SMTP_PASSWORD for ${DEFAULT_SMTP_USER}: " SMTP_PASSWORD
    echo
  else
    echo "ERROR: SMTP_PASSWORD required ( --smtp-password or KLIP_SMTP_PASSWORD )" >&2
    exit 1
  fi
fi

if [[ -z "$SMTP_PASSWORD" ]]; then
  echo "ERROR: SMTP_PASSWORD is empty" >&2
  exit 1
fi

echo "Planned SMTP settings:"
echo "  EMAIL_FROM=${DEFAULT_EMAIL_FROM}"
echo "  SMTP_HOST=${DEFAULT_SMTP_HOST}"
echo "  SMTP_PORT=${DEFAULT_SMTP_PORT}"
echo "  SMTP_SECURE=${DEFAULT_SMTP_SECURE}"
echo "  SMTP_USER=${DEFAULT_SMTP_USER}"
echo "  SMTP_PASSWORD=********"
echo "  SMTP_REJECT_UNAUTHORIZED=${DEFAULT_SMTP_REJECT}"
echo "  CONTRACT_ETA_REMINDER_ENABLED=true"
echo "  CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS=${TEST_TO}"
echo

if [[ "$APPLY" != true ]]; then
  echo "Preview only. Re-run with --apply to write env files and restart backend."
  echo "Example:"
  echo "  bash docs/scripts/setup-sit-smtp-eta-reminder-staging.sh --apply --test-to ${TEST_TO}"
  exit 0
fi

echo "==> Writing SMTP keys to ${ROOT_ENV} and ${BACKEND_ENV}"
for env_file in "$ROOT_ENV" "$BACKEND_ENV"; do
  upsert_env_var "$env_file" EMAIL_FROM "$DEFAULT_EMAIL_FROM"
  upsert_env_var "$env_file" SMTP_HOST "$DEFAULT_SMTP_HOST"
  upsert_env_var "$env_file" SMTP_PORT "$DEFAULT_SMTP_PORT"
  upsert_env_var "$env_file" SMTP_SECURE "$DEFAULT_SMTP_SECURE"
  upsert_env_var "$env_file" SMTP_USER "$DEFAULT_SMTP_USER"
  upsert_env_var "$env_file" SMTP_PASSWORD "$SMTP_PASSWORD"
  upsert_env_var "$env_file" SMTP_REJECT_UNAUTHORIZED "$DEFAULT_SMTP_REJECT"
  upsert_env_var "$env_file" CONTRACT_ETA_REMINDER_ENABLED "true"
  upsert_env_var "$env_file" CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS "$TEST_TO"
done

echo "==> Restarting backend (recreate to load SMTP env)"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate backend

echo "==> Waiting for backend health..."
sleep 5
if ! docker compose -f "$COMPOSE_FILE" exec -T backend node -e "require('http').get('http://127.0.0.1:5001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"; then
  echo "WARN: /health not ready yet — check: docker compose -f ${COMPOSE_FILE} logs --tail=40 backend"
fi

echo "==> SMTP env inside container"
SMTP_IN_CONTAINER="$(docker compose -f "$COMPOSE_FILE" exec -T backend printenv SMTP_HOST 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$SMTP_IN_CONTAINER" ]]; then
  echo "FAIL: SMTP_HOST still empty in klip-backend container." >&2
  echo "      Check ${ROOT_ENV} is loaded by compose and re-run this script." >&2
  exit 1
fi
echo "OK: SMTP_HOST=${SMTP_IN_CONTAINER}"

if [[ "$SKIP_TEST" == true ]]; then
  echo "Done (SMTP configured, test skipped)."
  exit 0
fi

echo
echo "==> Sending test Contract ETA reminder email"
TEST_ARGS=(--to "$TEST_TO")
if [[ "$RECIPIENTS_ONLY" == true ]]; then
  TEST_ARGS+=(--recipients-only)
fi
bash "${APP_DIR}/docs/scripts/run-contract-eta-reminder-staging.sh" "${TEST_ARGS[@]}"
