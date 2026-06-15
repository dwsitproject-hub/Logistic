#!/usr/bin/env bash
# KLIP staging — backend server (172.28.92.57)
# Run on the server after SSH (PuTTY): bash staging-deploy-backend.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-SIT}"
COMPOSE_FILE="docker-compose.backend.yml"

echo "==> KLIP staging backend deploy"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

cd "${APP_DIR}"

echo "==> Fetch and checkout ${BRANCH}"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

if [[ -f "${APP_DIR}/docs/scripts/staging-mount-synology-dev.sh" ]]; then
  echo "==> Ensure Synology upload mount (APPs/dev)"
  if [[ -f "${APP_DIR}/.synology-credentials" ]]; then
    sudo bash "${APP_DIR}/docs/scripts/staging-mount-synology-dev.sh" || {
      echo "WARN: Synology mount failed — uploads may fail until mount is fixed."
      echo "See docs/STAGING-SYNOLOGY-UPLOADS.md"
    }
  else
    echo "WARN: ${APP_DIR}/.synology-credentials missing — skip auto-mount."
    echo "See docs/STAGING-SYNOLOGY-UPLOADS.md"
  fi
fi

echo "==> Rebuild and restart backend stack"
docker compose -f "${COMPOSE_FILE}" up -d --build

echo "==> Container status"
docker compose -f "${COMPOSE_FILE}" ps

echo "==> Recent backend logs"
docker compose -f "${COMPOSE_FILE}" logs --tail=40 backend

echo "==> Health check (local)"
curl -sf "http://127.0.0.1:5001/health" && echo || echo "WARN: /health failed — check logs"

echo "Done. Tail logs: docker compose -f ${COMPOSE_FILE} logs -f backend"
