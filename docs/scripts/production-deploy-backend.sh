#!/usr/bin/env bash
# KLIP production — backend server (172.28.80.51)
# Always uses the remote-db overlay so klip-postgres never starts (Apsara RDS).
# Run on the server after SSH (PuTTY): bash production-deploy-backend.sh
#
# Do not use staging-deploy-backend.sh here (that defaults BRANCH=SIT).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="docker-compose.backend.yml"
OVERLAY_FILE="docker-compose.backend.remote-db.yml"
APSARA_HOST="pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com"
SIT_RDS_HOST="pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com"

env_value() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  grep -E "^${key}=" "${file}" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'"
}

echo "==> KLIP production backend deploy"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "ERROR: ${APP_DIR} is not a git clone. Run docs/scripts/production-bootstrap-backend.sh first."
  exit 1
fi

cd "${APP_DIR}"

if [[ ! -f "${OVERLAY_FILE}" ]]; then
  echo "ERROR: missing ${OVERLAY_FILE} — production must not start co-located postgres."
  exit 1
fi

echo "==> Fetch and checkout ${BRANCH}"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"
git log -1 --oneline

ROOT_ENV="${APP_DIR}/.env"
BE_ENV="${APP_DIR}/backend/.env"
if [[ ! -f "${ROOT_ENV}" ]]; then
  echo "ERROR: missing ${ROOT_ENV}. Run production-bootstrap-backend.sh, then fill DB_*."
  exit 1
fi

DB_HOST="$(env_value "${ROOT_ENV}" DB_HOST)"
DB_PORT="$(env_value "${ROOT_ENV}" DB_PORT)"
DB_NAME="$(env_value "${ROOT_ENV}" DB_NAME)"
DB_USER="$(env_value "${ROOT_ENV}" DB_USER)"
DB_PASSWORD="$(env_value "${ROOT_ENV}" DB_PASSWORD)"
BACKEND_PORT="$(env_value "${ROOT_ENV}" BACKEND_PORT)"
BACKEND_PORT="${BACKEND_PORT:-5001}"

if [[ -z "${DB_NAME}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" ]]; then
  echo "ERROR: fill DB_NAME, DB_USER, and DB_PASSWORD in ${ROOT_ENV} (and backend/.env) before deploy."
  echo "       DB_HOST should stay ${APSARA_HOST}"
  exit 1
fi

if [[ -z "${DB_HOST}" || "${DB_HOST}" == "klip-postgres" || "${DB_HOST}" == "postgres" ]]; then
  echo "ERROR: DB_HOST must be the production Apsara host, not local docker postgres."
  echo "       expected: ${APSARA_HOST}"
  exit 1
fi

if [[ "${DB_HOST}" == "${SIT_RDS_HOST}" ]]; then
  echo "ERROR: DB_HOST is the SIT RDS instance. Production Apsara is ${APSARA_HOST}"
  exit 1
fi

if [[ "${DB_HOST}" != "${APSARA_HOST}" ]]; then
  echo "WARN: DB_HOST=${DB_HOST} (expected ${APSARA_HOST}). Continuing only if infra gave you a new endpoint."
fi

echo "==> Env (from ${ROOT_ENV}): DB_HOST=${DB_HOST} DB_PORT=${DB_PORT:-5432} BACKEND_PORT=${BACKEND_PORT}"

COMPOSE_ARGS=(-f "${COMPOSE_FILE}" -f "${OVERLAY_FILE}")
KLIP_UPLOAD_MOUNT="$(env_value "${ROOT_ENV}" KLIP_UPLOAD_MOUNT)"
KLIP_UPLOAD_MOUNT="${KLIP_UPLOAD_MOUNT:-/mnt/synology/dev/KLIP}"
export KLIP_UPLOAD_MOUNT
if [[ -d "${KLIP_UPLOAD_MOUNT}" ]]; then
  COMPOSE_ARGS+=(-f docker-compose.backend.synology.yml)
  echo "==> Commercial docs NAS (production): ${KLIP_UPLOAD_MOUNT} -> /app/uploads"
else
  echo "WARN: ${KLIP_UPLOAD_MOUNT} missing — commercial uploads stay on Docker volume (NAS folder will stay empty)"
fi
KLIP_COMMERCIAL_DOCS_SHARE="$(env_value "${ROOT_ENV}" KLIP_COMMERCIAL_DOCS_SHARE)"
if [[ "${KLIP_COMMERCIAL_DOCS_SHARE}" != "1" ]]; then
  echo "WARN: set KLIP_ENV=prod and KLIP_COMMERCIAL_DOCS_SHARE=1 in ${ROOT_ENV} so uploads use COMMERCIAL DOCS/{YYYY}/{MM}"
fi
echo "==> Rebuild backend with Apsara overlay (will not start klip-postgres)"
docker compose "${COMPOSE_ARGS[@]}" up -d --build backend

echo "==> Container status"
docker compose "${COMPOSE_ARGS[@]}" ps

if docker ps --format '{{.Names}}' | grep -qx 'klip-postgres'; then
  echo "ERROR: klip-postgres is running — overlay failed. Stop it and re-run with both compose files."
  exit 1
fi

echo "==> Backend DB pointing (container)"
docker compose "${COMPOSE_ARGS[@]}" exec -T backend printenv DB_HOST DB_PORT

echo "==> Recent backend logs"
docker compose "${COMPOSE_ARGS[@]}" logs --tail=40 backend

# Poll rather than ask once. The container is barely a second old at this point - it still has
# migrations and seeding ahead of it - so a single immediate curl reports a failure that is really
# just impatience, and it did so on every deploy until someone stopped believing it.
echo "==> Health check (local ${BACKEND_PORT}, up to ${HEALTH_TIMEOUT:-60}s)"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
health_ok=0
for (( waited=0; waited < HEALTH_TIMEOUT; waited+=3 )); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health"; then
    echo
    echo "    healthy after ${waited}s"
    health_ok=1
    break
  fi
  sleep 3
done
if [[ "${health_ok}" != "1" ]]; then
  echo "ERROR: /health still failing after ${HEALTH_TIMEOUT}s — check logs: docker compose ${COMPOSE_ARGS[*]} logs -f backend"
  exit 1
fi

if [[ -f "${APP_DIR}/docs/scripts/verify-oidc-config.sh" ]]; then
  echo "==> OIDC env verification (optional on first PoC)"
  bash "${APP_DIR}/docs/scripts/verify-oidc-config.sh" || echo "WARN: OIDC verify failed — set OIDC_* in ${ROOT_ENV} or ${BE_ENV} when Hub is ready"
fi

echo "Done. Tail logs: docker compose ${COMPOSE_ARGS[*]} logs -f backend"
echo "Do not publish ${BACKEND_PORT} on the public EIP — FE reaches this host via 172.28.80.51"
