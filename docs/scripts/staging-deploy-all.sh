#!/usr/bin/env bash
# KLIP staging — run BOTH deploys from a jump host that can SSH to .57 and .56
# Usage: bash staging-deploy-all.sh
# Or from Windows: docs/scripts/staging-deploy-plink.bat

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_HOST="${BACKEND_HOST:-172.28.92.57}"
FRONTEND_HOST="${FRONTEND_HOST:-172.28.92.56}"
SSH_USER="${SSH_USER:-ubuntu}"
APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-SIT}"

run_remote() {
  local host="$1"
  local script="$2"
  echo ""
  echo "========================================"
  echo "Deploy on ${host}"
  echo "========================================"
  ssh "${SSH_USER}@${host}" "cd ${APP_DIR} && git fetch origin && git checkout ${BRANCH} && git pull origin ${BRANCH} && bash ${APP_DIR}/${script}"
}

echo "KLIP staging full deploy (branch: ${BRANCH})"
echo "  Backend:  ${BACKEND_HOST}"
echo "  Frontend: ${FRONTEND_HOST}"

run_remote "${BACKEND_HOST}" "docs/scripts/staging-deploy-backend.sh"
run_remote "${FRONTEND_HOST}" "docs/scripts/staging-deploy-frontend.sh"

echo ""
echo "Done. Verify: http://8.215.6.189"
echo "See docs/scripts/staging-deploy-putty.txt for manual PuTTY steps."
