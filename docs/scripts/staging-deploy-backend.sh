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

COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
if [[ "${KLIP_UPLOAD_USE_SYNOLOGY:-0}" == "1" ]]; then
  if [[ -f "${APP_DIR}/docker-compose.backend.synology.yml" ]]; then
    COMPOSE_ARGS+=(-f docker-compose.backend.synology.yml)
    echo "==> Synology upload mode (KLIP_UPLOAD_USE_SYNOLOGY=1)"
    if [[ -f "${APP_DIR}/docs/scripts/staging-mount-synology-dev.sh" ]] && [[ -f "${APP_DIR}/.synology-credentials" ]]; then
      sudo bash "${APP_DIR}/docs/scripts/staging-mount-synology-dev.sh" || {
        echo "WARN: Synology mount failed — set KLIP_UPLOAD_USE_SYNOLOGY=0 or fix network/mount."
        echo "See docs/STAGING-SYNOLOGY-UPLOADS.md"
      }
    else
      echo "WARN: .synology-credentials missing — mount skipped."
    fi
  else
    echo "WARN: docker-compose.backend.synology.yml missing — using Docker volume backend_uploads."
  fi
else
  echo "==> Upload storage: Docker volume backend_uploads (default; Synology when KLIP_UPLOAD_USE_SYNOLOGY=1)"
fi

echo "==> Rebuild and restart backend stack"
docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo "==> Container status"
docker compose "${COMPOSE_ARGS[@]}" ps

echo "==> Recent backend logs"
docker compose "${COMPOSE_ARGS[@]}" logs --tail=40 backend

echo "==> Health check (local)"
curl -sf "http://127.0.0.1:5001/health" && echo || echo "WARN: /health failed — check logs"

if [[ -f "${APP_DIR}/docs/scripts/verify-oidc-config.sh" ]]; then
  echo "==> OIDC env verification (Hub Admin alignment)"
  bash "${APP_DIR}/docs/scripts/verify-oidc-config.sh" || echo "WARN: OIDC verify failed — set OIDC_* in /opt/klip/.env or backend/.env"
fi

echo "Done. Tail logs: docker compose ${COMPOSE_ARGS[*]} logs -f backend"
echo ""
echo "Post-deploy data fix (dedupe + master vessel):"
echo "  bash docs/scripts/staging-deploy-backend-full.sh --skip-deploy"
