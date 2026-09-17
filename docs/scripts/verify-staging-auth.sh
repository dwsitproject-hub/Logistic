#!/usr/bin/env bash
# Diagnose KLIP staging auth (local login + SSO cookies through nginx).
# Run on FRONTEND server (172.28.92.56):
#   sudo bash docs/scripts/verify-staging-auth.sh
# Optional:
#   KLIP_USER=admin KLIP_PASS=secret sudo bash docs/scripts/verify-staging-auth.sh

set -euo pipefail

KLIP_HOST="${KLIP_HOST:-test-klip.kpndomain.com}"
BACKEND="${BACKEND:-172.28.92.57:5001}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/klip-auth-test-cookies.txt}"

echo "==> 1) API health via nginx"
curl -sf -H "Host: ${KLIP_HOST}" "http://127.0.0.1/api/health" | head -c 200
echo ""

echo "==> 2) Login options"
curl -sf -H "Host: ${KLIP_HOST}" "http://127.0.0.1/api/auth/login-options"
echo ""

echo "==> 3) /auth/me without cookie (expect 401)"
code=$(curl -so /dev/null -w "%{http_code}" -H "Host: ${KLIP_HOST}" "http://127.0.0.1/api/auth/me")
echo "HTTP ${code}"

if [[ -n "${KLIP_USER:-}" && -n "${KLIP_PASS:-}" ]]; then
  echo "==> 4) Local login POST (expect 200 + Set-Cookie)"
  rm -f "${COOKIE_JAR}"
  curl -si -c "${COOKIE_JAR}" \
    -H "Host: ${KLIP_HOST}" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${KLIP_USER}\",\"password\":\"${KLIP_PASS}\"}" \
    "http://127.0.0.1/api/auth/login" | head -25

  echo ""
  echo "==> 5) /auth/me with session cookie (expect 200)"
  curl -si -b "${COOKIE_JAR}" -H "Host: ${KLIP_HOST}" "http://127.0.0.1/api/auth/me" | head -20
else
  echo "==> 4) Skip login test — set KLIP_USER and KLIP_PASS to test local login + cookie"
fi

echo ""
echo "==> 6) OIDC login redirect via nginx (expect 302)"
curl -si -H "Host: ${KLIP_HOST}" "http://127.0.0.1/auth/oidc/login" | head -12

echo ""
echo "==> 7) nginx location blocks"
grep -n "location" /etc/nginx/sites-available/klip 2>/dev/null || echo "nginx site not found"

echo ""
echo "Done. In browser DevTools → Network: POST /api/auth/login should return Set-Cookie: klip.sid"
