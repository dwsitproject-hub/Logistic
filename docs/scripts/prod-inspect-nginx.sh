#!/usr/bin/env bash
#
# READ-ONLY inspection of the production frontend host (172.28.80.50), run BEFORE adding
# the klip.kpndomain.com vhost.
#
# This script writes nothing, reloads nothing, starts nothing. Every command below either
# prints a file or queries state. Safe on a host serving live applications.
#
# HTTPS is deliberately out of scope for now - klip runs HTTP-only first. (For later: the
# hostnames here resolve to a private address, so Let's Encrypt HTTP-01 can never reach
# them; the existing certs must come from DNS-01. Section 6 records what is already set up
# so that step is easy when we get to it.)
#
#   sudo bash /opt/klip/docs/scripts/prod-inspect-nginx.sh 2>&1 | tee /tmp/klip-nginx-inspect.txt
#
set -u

line() { printf '\n==================== %s ====================\n' "$1"; }

line "1. nginx version"
nginx -v 2>&1

line "2. enabled sites, in the order nginx loads them"
# Load order decides the default server when no block declares default_server, and
# sites-enabled/* is globbed ALPHABETICALLY. That is how a new filename can silently
# steal the default from an application already on this box. We need the exact names.
for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
  [ -d "$d" ] && { printf '\n--- %s ---\n' "$d"; ls -1 "$d" 2>/dev/null | sort; }
done

line "3. include directives in nginx.conf"
grep -nE '^\s*include' /etc/nginx/nginx.conf 2>/dev/null || true

line "4. THE CRITICAL ONE - who owns default_server"
# Empty output here means NO block is an explicit default, so load order decides it and
# our filename must sort AFTER the current first file. If a block DOES declare
# default_server, we are safe regardless of our filename.
nginx -T 2>/dev/null | grep -nE 'listen[^;]*default_server' \
  || echo '(none declared - load order decides the default; our filename matters)'

line "5. every server_name configured today (collision check)"
nginx -T 2>/dev/null | grep -E '^\s*server_name' | sed 's/^[[:space:]]*//' | sort -u

line "6. does anything already mention klip? / what certbot has today"
nginx -T 2>/dev/null | grep -n 'klip' || echo '(nothing - the name is free)'
printf '\n--- existing cert issuance method, for the HTTPS step later ---\n'
grep -hE '^(authenticator|installer)\s*=' /etc/letsencrypt/renewal/*.conf 2>/dev/null | sort -u \
  || echo '(no renewal configs readable)'

line "7. what is listening on 80 / 443 / 3001"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':(80|443|3001)[[:space:]]' || true

line "8. can this host reach the backend? (/api and /auth proxy there)"
curl -sS -o /dev/null -w 'backend 172.28.80.51:5001 -> HTTP %{http_code} in %{time_total}s\n' \
  --max-time 10 http://172.28.80.51:5001/health 2>&1 \
  || echo 'backend UNREACHABLE from this host - the vhost would 502 on /api'

line "9. DNS as THIS host sees it"
getent hosts klip.kpndomain.com || echo 'klip.kpndomain.com does NOT resolve on this host'

line "DONE - nothing was modified"
