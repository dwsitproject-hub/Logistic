#!/usr/bin/env bash
# KLIP production — first-time backend host (172.28.80.51)
# Installs Docker if missing, clones /opt/klip on main, writes Apsara placeholder env.
# Does not start containers. After filling DB_NAME/DB_USER/DB_PASSWORD, run production-deploy-backend.sh
#
# Clone auth (private repo): set on the server, never in this file / git / Excel dump:
#   export GIT_CLONE_URL='https://<github-user>:<PAT>@github.com/dwsitproject-hub/Logistic.git'

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-main}"
GIT_CLONE_URL="${GIT_CLONE_URL:-https://github.com/dwsitproject-hub/Logistic.git}"
APSARA_HOST="pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com"

echo "==> KLIP production backend bootstrap"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root (PuTTY user root on ECS-DB)."
  exit 1
fi

install_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: git is missing and apt-get was not found. Install git, then re-run."
    exit 1
  fi
  echo "==> Installing git"
  apt-get update
  apt-get install -y git ca-certificates curl
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "==> Docker already present"
    docker --version
    docker compose version
    return 0
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: Docker missing and apt-get not found. Install Docker Engine + Compose v2 (see docs/DEPLOYMENT.md §2.2), then re-run."
    exit 1
  fi
  echo "==> Installing Docker Engine + Compose v2 (docs/DEPLOYMENT.md §2.2)"
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 644 /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  docker --version
  docker compose version
}

ensure_repo() {
  mkdir -p "${APP_DIR}"
  if [[ -d "${APP_DIR}/.git" ]]; then
    echo "==> ${APP_DIR} already a git repo — fetch/checkout/pull ${BRANCH}"
    git -C "${APP_DIR}" fetch origin
    git -C "${APP_DIR}" checkout "${BRANCH}"
    git -C "${APP_DIR}" pull origin "${BRANCH}"
    return 0
  fi
  if [[ -n "$(ls -A "${APP_DIR}" 2>/dev/null)" ]]; then
    echo "ERROR: ${APP_DIR} is not empty and is not a git repo. Move/rename it, then re-run."
    exit 1
  fi
  echo "==> Cloning into ${APP_DIR}"
  git clone "${GIT_CLONE_URL}" "${APP_DIR}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
}

write_placeholder_env() {
  local path="$1"
  if [[ -f "${path}" ]]; then
    echo "==> Keep existing ${path} (not overwritten)"
    return 0
  fi
  echo "==> Writing placeholder ${path} (fill DB_NAME/DB_USER/DB_PASSWORD before deploy)"
  mkdir -p "$(dirname "${path}")"
  cat >"${path}" <<EOF
# KLIP production — Apsara PostgreSQL (NOT SIT RDS, NOT local klip-postgres).
# Fill DB_NAME / DB_USER / DB_PASSWORD from Excel on this server only. Do not commit.

NODE_ENV=production
PORT=5001
BACKEND_PORT=5001

DB_HOST=${APSARA_HOST}
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=

KLIP_FAIL_ON_LOCAL_DB=true

JWT_SECRET=CHANGE_ME
JWT_EXPIRES_IN=7d

FRONTEND_URL=http://147.139.176.70
CORS_EXTRA_ORIGINS=http://147.139.176.70
TRUST_PROXY=1

# Production SMTP (Excel Production sheet). Set host/user/password on the server only.
SMTP_PORT=465
SMTP_SECURE=true
EOF
  chmod 600 "${path}"
}

install_git
install_docker_if_needed
ensure_repo
write_placeholder_env "${APP_DIR}/.env"
write_placeholder_env "${APP_DIR}/backend/.env"

echo "==> Bootstrap done. Next:"
echo "    1. Edit ${APP_DIR}/.env and ${APP_DIR}/backend/.env — set DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET"
echo "    2. bash ${APP_DIR}/docs/scripts/production-deploy-backend.sh"
echo "    Confirm DB_HOST is ${APSARA_HOST} (not pgm-d9jx9o06qae8gf3h / klip-postgres)"
git -C "${APP_DIR}" log -1 --oneline
