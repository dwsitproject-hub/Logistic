#!/usr/bin/env bash
# KLIP staging — frontend server (172.28.92.56)
# Run on the server after SSH (PuTTY): bash staging-deploy-frontend.sh
# NEXT_PUBLIC_* is baked at build time — always use --build after git pull.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-SIT}"
COMPOSE_FILE="docker-compose.frontend.yml"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://172.28.92.57:5001/health}"

echo "==> KLIP staging frontend deploy"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

echo "==> Backend reachability (from this host)"
curl -sf "${BACKEND_HEALTH_URL}" && echo || echo "WARN: backend not reachable at ${BACKEND_HEALTH_URL}"

cd "${APP_DIR}"

echo "==> Fetch and checkout ${BRANCH}"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

echo "==> Rebuild and restart frontend stack"
docker compose -f "${COMPOSE_FILE}" up -d --build

echo "==> Container status"
docker compose -f "${COMPOSE_FILE}" ps

echo "==> Recent frontend logs"
docker compose -f "${COMPOSE_FILE}" logs --tail=40 frontend

echo "Done. Verify in browser: http://8.215.6.189 (or your staging public IP)"
