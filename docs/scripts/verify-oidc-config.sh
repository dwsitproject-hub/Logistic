#!/usr/bin/env bash
# Verify OIDC env alignment with Hub Admin registration (Logistic app).
# Run on backend host after setting /opt/klip/.env or backend/.env:
#   bash docs/scripts/verify-oidc-config.sh

set -euo pipefail

EXPECTED_CLIENT_ID="logistic"
EXPECTED_REDIRECT_URI="http://test-klip.kpndomain.com/auth/oidc/callback"
EXPECTED_DISCOVERY="http://test-dwshub.kpndomain.com/api/sso/.well-known/openid-configuration"

fail=0

load_env() {
  local f line key val
  for f in "${APP_DIR:-/opt/klip}/.env" "${APP_DIR:-/opt/klip}/backend/.env"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      printf -v "$key" '%s' "$val"
      export "$key"
    done < "$f"
  done
}

check_var() {
  local name="$1"
  local expected="$2"
  local actual="${!name:-}"
  if [[ -z "$actual" ]]; then
    echo "FAIL: ${name} is not set"
    fail=1
    return
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: ${name}=${actual}"
    echo "      expected ${expected}"
    fail=1
    return
  fi
  echo "OK:   ${name}=${actual}"
}

echo "==> OIDC config check (Hub Admin must match)"
load_env

check_var OIDC_CLIENT_ID "$EXPECTED_CLIENT_ID"
check_var OIDC_REDIRECT_URI "$EXPECTED_REDIRECT_URI"

if [[ -z "${OIDC_DISCOVERY_URL:-}" ]]; then
  echo "FAIL: OIDC_DISCOVERY_URL is not set"
  fail=1
elif [[ "${OIDC_DISCOVERY_URL}" != "$EXPECTED_DISCOVERY" ]]; then
  echo "WARN: OIDC_DISCOVERY_URL=${OIDC_DISCOVERY_URL} (expected ${EXPECTED_DISCOVERY})"
else
  echo "OK:   OIDC_DISCOVERY_URL=${OIDC_DISCOVERY_URL}"
fi

if [[ -z "${SESSION_SECRET:-}" ]]; then
  echo "FAIL: SESSION_SECRET is not set"
  fail=1
else
  echo "OK:   SESSION_SECRET is set"
fi

if [[ -z "${FRONTEND_URL:-}" ]]; then
  echo "FAIL: FRONTEND_URL is not set"
  fail=1
else
  echo "OK:   FRONTEND_URL=${FRONTEND_URL}"
fi

echo "==> Hub discovery document"
if curl -sf "${OIDC_DISCOVERY_URL:-$EXPECTED_DISCOVERY}" | head -c 200 | grep -q issuer; then
  echo "OK:   discovery URL returns JSON with issuer"
else
  echo "FAIL: discovery URL did not return valid OIDC JSON"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "OIDC verification failed — fix env before SSO login test."
  exit 1
fi

echo "OIDC verification passed."
