#!/usr/bin/env bash
# KLIP SIT — configure nginx for OIDC SSO (/auth/ → backend) + verify.
# Run on FRONTEND server (172.28.92.56) as root:
#   sudo bash docs/scripts/configure-klip-nginx-sso.sh

set -euo pipefail

KLIP_SERVER_NAME="${KLIP_SERVER_NAME:-test-klip.kpndomain.com}"
KLIP_BACKEND_HOST="${KLIP_BACKEND_HOST:-172.28.92.57:5001}"
KLIP_FRONTEND_HOST="${KLIP_FRONTEND_HOST:-127.0.0.1:3001}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/klip}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/klip}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: run as root (e.g. sudo bash $0)"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "ERROR: nginx is not installed"
  exit 1
fi

mkdir -p "$(dirname "$NGINX_SITE")"
mkdir -p "$(dirname "$NGINX_ENABLED")"

if [[ -f "$NGINX_SITE" ]]; then
  backup="${NGINX_SITE}.bak.$(date +%Y%m%d_%H%M%S)"
  cp -a "$NGINX_SITE" "$backup"
  echo "==> Backed up existing config to ${backup}"
fi

echo "==> Writing ${NGINX_SITE}"
cat >"$NGINX_SITE" <<EOF
upstream klip_frontend {
    server ${KLIP_FRONTEND_HOST};
}
upstream klip_backend {
    server ${KLIP_BACKEND_HOST};
}
server {
    listen 80;
    listen [::]:80;
    server_name ${KLIP_SERVER_NAME};

    location /api/sap-master-v2/import-upload {
        proxy_pass http://klip_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_max_body_size 50M;
    }

    location /api/ {
        proxy_pass http://klip_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }

    location /auth/ {
        proxy_pass http://klip_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://klip_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
echo "==> Enabled ${NGINX_ENABLED}"

echo "==> Location blocks:"
grep -n "location" "$NGINX_SITE"

echo "==> nginx -t"
nginx -t

echo "==> reload nginx"
systemctl reload nginx

echo ""
echo "==> 1) Backend direct (expect 302):"
curl -si --max-time 15 "http://${KLIP_BACKEND_HOST}/auth/oidc/login" | head -12

echo ""
echo "==> 2) Via nginx (expect 302):"
curl -si --max-time 15 -H "Host: ${KLIP_SERVER_NAME}" "http://127.0.0.1/auth/oidc/login" | head -12

echo ""
echo "==> 3) API health via nginx:"
curl -si --max-time 10 -H "Host: ${KLIP_SERVER_NAME}" "http://127.0.0.1/api/health" | head -8

echo ""
echo "==> 4) Login options via nginx:"
curl -sf --max-time 10 -H "Host: ${KLIP_SERVER_NAME}" "http://127.0.0.1/api/auth/login-options" || true
echo ""

echo ""
echo "Done. Browser: http://${KLIP_SERVER_NAME}/login"
echo "Verify local login: KLIP_USER=xxx KLIP_PASS=yyy sudo bash docs/scripts/verify-staging-auth.sh"
