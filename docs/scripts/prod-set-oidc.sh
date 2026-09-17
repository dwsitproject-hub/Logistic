#!/usr/bin/env bash
# Add the SSO/OIDC block to the production backend's /opt/klip/.env - after proving the Hub is
# actually reachable and speaks OIDC.
#
#   bash docs/scripts/prod-set-oidc.sh
#
# Run on the production BACKEND host (172.28.80.51).
#
# Order matters, as with prod-set-db-credentials.sh: everything is verified FIRST and .env is
# written only on success. A discovery URL that is wrong, unreachable from this host, or that
# returns the Hub's SPA HTML instead of JSON is caught here rather than as a login failure later.
#
# It MERGES: existing keys are replaced in place, everything else in .env is left untouched, and
# a timestamped backup is taken before anything is written.

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/klip/.env}"

echo "=== running on: $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}')) ==="
echo "=== env file  : $ENV_FILE"
echo

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE - run prod-bootstrap-dirs.sh first" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl not found on this host - install it first" >&2; exit 1; }

# Parse, never source. A .env is not a shell script: `OIDC_SCOPES=openid email profile` is a
# legal line that `source` turns into a command called `email`.
envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }

CUR_DISCOVERY="$(envval OIDC_DISCOVERY_URL)"
CUR_CLIENT_ID="$(envval OIDC_CLIENT_ID)"
CUR_REDIRECT="$(envval OIDC_REDIRECT_URI)"
CUR_SESSION_SECRET="$(envval SESSION_SECRET)"

# --- 1. Discovery URL -------------------------------------------------------------------------
echo "--- Hub discovery URL ---"
echo "    staging uses: http://test-dwshub.kpndomain.com/api/sso/.well-known/openid-configuration"
echo "    the production host is NOT assumed - paste the value the Hub admin gave you."
echo
read -rp "OIDC_DISCOVERY_URL${CUR_DISCOVERY:+ [$CUR_DISCOVERY]}: " DISCOVERY
DISCOVERY="${DISCOVERY:-$CUR_DISCOVERY}"
[ -n "$DISCOVERY" ] || { echo "empty - aborted, $ENV_FILE unchanged" >&2; exit 1; }

# --- 2. Redirect URI --------------------------------------------------------------------------
echo
echo "--- Redirect URI ---"
echo "    Must match a URI registered in Hub Admin BYTE-FOR-BYTE (scheme, host, port, path,"
echo "    no trailing slash). The backend sends exactly this one value in the token exchange,"
echo "    even when several are registered."
echo
echo "      1) http://172.28.80.50:3001/auth/oidc/callback   (private IP - testable now)"
echo "      2) https://klip.kpndomain.com/auth/oidc/callback (domain - needs DNS + TLS + Nginx)"
echo "      3) enter another value"
echo
read -rp "choice [1/2/3]${CUR_REDIRECT:+ (current: $CUR_REDIRECT)}: " CHOICE
case "$CHOICE" in
  1) REDIRECT="http://172.28.80.50:3001/auth/oidc/callback" ;;
  2) REDIRECT="https://klip.kpndomain.com/auth/oidc/callback" ;;
  3) read -rp "OIDC_REDIRECT_URI: " REDIRECT ;;
  "") REDIRECT="$CUR_REDIRECT" ;;
  *) echo "unrecognised choice - aborted, $ENV_FILE unchanged" >&2; exit 1 ;;
esac
[ -n "$REDIRECT" ] || { echo "empty - aborted, $ENV_FILE unchanged" >&2; exit 1; }

case "$REDIRECT" in
  */auth/oidc/callback) : ;;
  *) echo
     echo ">>> STOP: the path must be exactly /auth/oidc/callback - that is the route the backend"
     echo "    registers in server.ts. Got: $REDIRECT"
     exit 1 ;;
esac

# FRONTEND_URL is the origin the BROWSER uses; it is where login redirects land. It is the
# redirect URI minus the callback path, which is the single-origin requirement restated.
FRONTEND="${REDIRECT%/auth/oidc/callback}"

# The cookie can only carry Secure when the browser is actually on HTTPS - otherwise it is set
# and then never sent back, and login silently loops.
case "$FRONTEND" in
  https://*) COOKIE_SECURE=true ;;
  *)         COOKIE_SECURE=false ;;
esac

read -rp "OIDC_CLIENT_ID [${CUR_CLIENT_ID:-logistic}]: " CLIENT_ID
CLIENT_ID="${CLIENT_ID:-${CUR_CLIENT_ID:-logistic}}"

echo
echo "    OIDC_DISCOVERY_URL    = $DISCOVERY"
echo "    OIDC_CLIENT_ID        = $CLIENT_ID"
echo "    OIDC_REDIRECT_URI     = $REDIRECT"
echo "    FRONTEND_URL          = $FRONTEND"
echo "    SESSION_COOKIE_SECURE = $COOKIE_SECURE"

# --- 3. Prove the Hub is reachable FROM THIS HOST ----------------------------------------------
# From this host specifically: the browser reaching the Hub proves nothing about the token
# exchange, which the backend makes server-to-server.
echo
echo "--- fetching the discovery document from this host (nothing written yet) ---"
BODY="$(curl -sS --max-time 15 "$DISCOVERY" 2>/tmp/oidc_curl_$$)"
RC=$?
if [ $RC -ne 0 ]; then
  echo ">>> FAILED to fetch (curl exit $RC):"
  sed 's/^/    /' /tmp/oidc_curl_$$
  rm -f /tmp/oidc_curl_$$
  echo
  echo "    Usual causes: wrong host name, or no outbound route from this host to the Hub."
  echo "    Ask infra to open it - the backend needs this path for the token exchange."
  echo "    $ENV_FILE unchanged."
  exit 1
fi
rm -f /tmp/oidc_curl_$$

case "$BODY" in
  *"<html"*|*"<!DOCTYPE"*|*"<!doctype"*)
    echo ">>> STOP: that URL returned HTML, not JSON - it is the Hub web UI, not its discovery"
    echo "    endpoint. The path must end in /api/sso/.well-known/openid-configuration"
    echo "    $ENV_FILE unchanged."
    exit 1 ;;
esac

MISSING=""
for k in issuer authorization_endpoint token_endpoint jwks_uri; do
  case "$BODY" in *"\"$k\""*) : ;; *) MISSING="$MISSING $k" ;; esac
done
if [ -n "$MISSING" ]; then
  echo ">>> STOP: the response is not a usable discovery document - missing:$MISSING"
  echo "    first 300 bytes:"
  printf '%s' "$BODY" | head -c 300 | sed 's/^/    /'
  echo
  echo "    $ENV_FILE unchanged."
  exit 1
fi
echo "    OK - issuer / authorization_endpoint / token_endpoint / jwks_uri all present"

# jwks_uri is fetched by the backend on every login to verify the ID token signature. A discovery
# document that resolves while its jwks_uri does not is a failure that only shows up at login.
JWKS="$(printf '%s' "$BODY" | tr ',' '\n' | grep -m1 '"jwks_uri"' | sed 's/.*"jwks_uri"[[:space:]]*:[[:space:]]*"//; s/".*//')"
if [ -n "$JWKS" ]; then
  echo "--- fetching jwks_uri: $JWKS"
  if curl -sSf --max-time 15 "$JWKS" 2>/dev/null | grep -q '"keys"'; then
    echo "    OK - signing keys returned"
  else
    echo ">>> STOP: jwks_uri is not reachable from this host, or returned no keys."
    echo "    Login would fail at ID-token verification. $ENV_FILE unchanged."
    exit 1
  fi
fi

# --- 4. Write, merging into what is already there ----------------------------------------------
if [ -z "$CUR_SESSION_SECRET" ]; then
  SESSION_SECRET_VAL="$(openssl rand -base64 48 | tr -d '\n')"
  echo
  echo "    SESSION_SECRET was absent - generated one"
else
  SESSION_SECRET_VAL="$CUR_SESSION_SECRET"
fi

BACKUP="$ENV_FILE.bak-$(date +%F-%H%M%S)"
cp -p "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"
echo
echo "--- backup: $BACKUP ---"

set_kv() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"; chmod 600 "$tmp"
  # Drop any existing definition, then append the new one. The value is written by printf, never
  # through a sed replacement, so a '/' or '&' in a URL cannot corrupt the file.
  grep -v "^${key}=" "$ENV_FILE" > "$tmp"
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

set_kv OIDC_DISCOVERY_URL      "$DISCOVERY"
set_kv OIDC_CLIENT_ID          "$CLIENT_ID"
set_kv OIDC_REDIRECT_URI       "$REDIRECT"
set_kv OIDC_SCOPES             "openid email profile"
set_kv FRONTEND_URL            "$FRONTEND"
set_kv SESSION_SECRET          "$SESSION_SECRET_VAL"
set_kv SESSION_COOKIE_SAMESITE "Lax"
set_kv SESSION_COOKIE_SECURE   "$COOKIE_SECURE"
set_kv TRUST_PROXY             "1"
set_kv SSO_LEGACY_BRIDGE       "false"

echo
echo ">>> OK - $ENV_FILE written"
sed 's/^\(DB_PASSWORD\|JWT_SECRET\|SESSION_SECRET\)=.*/\1=<set>/' "$ENV_FILE"

cat <<'NEXT'

--- next ---
1. Restart the backend so it picks the new environment up. Both compose files, always: without
   the remote-db overlay Compose also starts the co-located `postgres` service, which must stay
   down in production.
     cd /opt/klip
     docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml up -d backend
     docker logs --tail=50 klip-backend

2. Confirm the routes are live (they answer 503 while OIDC is unconfigured):
     curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:5001/auth/oidc/login
   Expect 302 with a redirect_url pointing at the Hub authorization endpoint - NOT 503.

3. Log in through a real BROWSER, at the same origin as the redirect URI. Not with curl: the
   session cookie is HttpOnly and host-bound, so the flow only completes in a browser.

NOTE: prod-set-db-credentials.sh rewrites .env from a fixed key list. Running it AFTER this
script would drop every key set here. Run this one last, or restore from the backup above.
NEXT
