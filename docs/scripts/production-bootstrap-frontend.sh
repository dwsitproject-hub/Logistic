#!/usr/bin/env bash
# KLIP production — first-time frontend host (172.28.80.50)
# Installs Docker if missing, clones /opt/klip on main, writes placeholder .env.
# Does not start containers. After bootstrap, run production-deploy-frontend.sh
#
# Clone auth (private repo): set on the server, never in this file / git / Excel dump:
#   export GIT_CLONE_URL='https://<github-user>:<PAT>@github.com/dwsitproject-hub/Logistic.git'

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/klip}"
BRANCH="${BRANCH:-main}"
GIT_CLONE_URL="${GIT_CLONE_URL:-https://github.com/dwsitproject-hub/Logistic.git}"

echo "==> KLIP production frontend bootstrap"
echo "    dir:    ${APP_DIR}"
echo "    branch: ${BRANCH}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root (PuTTY user root on ECS-App)."
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
  local path="${APP_DIR}/.env"
  if [[ -f "${path}" ]]; then
    echo "==> Keep existing ${path} (not overwritten)"
    return 0
  fi
  echo "==> Writing placeholder ${path}"
  cat >"${path}" <<'EOF'
# KLIP production frontend — Compose interpolates these at build time.
# NEXT_PUBLIC_* is baked into the image; always --build after changing it.

NEXT_PUBLIC_API_URL=/api
BACKEND_INTERNAL_URL=http://172.28.80.51:5001
FRONTEND_PORT=80
EOF
  chmod 600 "${path}"
}

install_git
install_docker_if_needed
ensure_repo
write_placeholder_env

echo "==> Bootstrap done. Next:"
echo "    bash ${APP_DIR}/docs/scripts/production-deploy-frontend.sh"
echo "    Browser: http://147.139.176.70  (after backend /health is OK)"
git -C "${APP_DIR}" log -1 --oneline
