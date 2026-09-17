#!/usr/bin/env bash
# KLIP production — frontend server (172.28.80.50)
# NEXT_PUBLIC_* is baked at build time — always use --build after git pull.
# Run on the server after SSH (PuTTY): bash production-deploy-frontend.sh
#
# Do not use staging-deploy-frontend.sh here (that defaults BRANCH=SIT and SIT backend IP).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="docker-compose.frontend.yml"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://172.28.80.51:5001/health}"

env_value() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  grep -E "^${key}=" "${file}" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'"
}

echo "==> KLIP production frontend deploy"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "ERROR: ${APP_DIR} is not a git clone. Run docs/scripts/production-bootstrap-frontend.sh first."
  exit 1
fi

echo "==> Backend reachability (from this host)"
curl -sf "${BACKEND_HEALTH_URL}" && echo || {
  echo "ERROR: backend not reachable at ${BACKEND_HEALTH_URL}"
  echo "       Deploy backend on 172.28.80.51 first, and confirm VPC allows this host → :5001."
  exit 1
}

cd "${APP_DIR}"

echo "==> Fetch and checkout ${BRANCH}"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"
git log -1 --oneline

ROOT_ENV="${APP_DIR}/.env"
if [[ ! -f "${ROOT_ENV}" ]]; then
  echo "ERROR: missing ${ROOT_ENV}. Run production-bootstrap-frontend.sh first."
  exit 1
fi

API_URL="$(env_value "${ROOT_ENV}" NEXT_PUBLIC_API_URL)"
BE_URL="$(env_value "${ROOT_ENV}" BACKEND_INTERNAL_URL)"
FE_PORT="$(env_value "${ROOT_ENV}" FRONTEND_PORT)"
FE_PORT="${FE_PORT:-80}"
echo "==> Env: NEXT_PUBLIC_API_URL=${API_URL:-/api} BACKEND_INTERNAL_URL=${BE_URL} FRONTEND_PORT=${FE_PORT}"

if [[ "${BE_URL}" == *"172.28.92.57"* ]]; then
  echo "ERROR: BACKEND_INTERNAL_URL still points at SIT (${BE_URL}). Set http://172.28.80.51:5001"
  exit 1
fi

echo "==> Rebuild and restart frontend stack"
docker compose -f "${COMPOSE_FILE}" up -d --build

echo "==> Container status"
docker compose -f "${COMPOSE_FILE}" ps

echo "==> Recent frontend logs"
docker compose -f "${COMPOSE_FILE}" logs --tail=40 frontend

echo "==> Local HTTP check :${FE_PORT}"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:${FE_PORT}/" || echo "WARN: local HTTP check failed"

echo "Done. Verify in browser: http://147.139.176.70  then Ctrl+Shift+R"
echo "API via Next rewrite: http://147.139.176.70/api/health"
