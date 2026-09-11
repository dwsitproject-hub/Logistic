#!/usr/bin/env bash
# Which ports are free on this server? Run ON the target server, before requesting from infra.
#
# Run on BOTH hosts - the answers differ, because different applications already run on each:
#   bash docs/scripts/prod-check-ports.sh backend     # on 172.28.80.51
#   bash docs/scripts/prod-check-ports.sh frontend    # on 172.28.80.50
#
# Reports three things per candidate, because "nothing is listening" is not the same as "free":
#   LISTENING  - a process holds it now
#   DOCKER     - a container publishes it (may be stopped now and restart later onto that port)
#   FREE       - neither
#
# Read-only: nothing is installed, started or changed.

set -u

ROLE="${1:-both}"

# Candidates in preference order. KLIP's compose files default to 5001 (backend, ${BACKEND_PORT})
# and 80 (frontend, ${FRONTEND_PORT} -> container 3001), so those come first: matching staging
# keeps one less difference between environments.
BACKEND_CANDIDATES="5001 5011 5021 5101 8081 8091"
FRONTEND_CANDIDATES="80 3001 3011 3021 8080 8090"

have() { command -v "$1" >/dev/null 2>&1; }

listening_ports() {
  if have ss; then
    ss -lntuH 2>/dev/null | awk '{print $5}' | sed 's/.*://' | sort -un
  elif have netstat; then
    netstat -lntu 2>/dev/null | awk 'NR>2 {print $4}' | sed 's/.*://' | sort -un
  else
    echo "ERR_NO_TOOL"
  fi
}

docker_ports() {
  have docker || return 0
  docker ps -a --format '{{.Ports}}' 2>/dev/null \
    | tr ',' '\n' \
    | grep -oE '(^|[^0-9])([0-9]{2,5})->' \
    | grep -oE '[0-9]{2,5}' \
    | sort -un
}

LISTEN="$(listening_ports)"
if [ "$LISTEN" = "ERR_NO_TOOL" ]; then
  echo "Neither ss nor netstat is available - cannot check. Install iproute2 or net-tools."
  exit 1
fi
DOCKER="$(docker_ports)"

check_one() {
  local port="$1"
  local state="FREE"
  local note=""
  if echo "$LISTEN" | grep -qx "$port"; then
    state="LISTENING"
    if have ss; then
      note="$(ss -lntupH 2>/dev/null | awk -v p=":$port$" '$5 ~ p {print $NF; exit}')"
    fi
  elif echo "$DOCKER" | grep -qx "$port"; then
    state="DOCKER"
    note="$(docker ps -a --filter "publish=$port" --format '{{.Names}} ({{.State}})' 2>/dev/null | head -1)"
  fi
  printf '  %-6s %-10s %s\n' "$port" "$state" "$note"
}

report() {
  local label="$1"; shift
  local candidates="$1"; shift
  echo
  echo "$label"
  for p in $candidates; do check_one "$p"; done
  echo
  local first_free=""
  for p in $candidates; do
    if ! echo "$LISTEN" | grep -qx "$p" && ! echo "$DOCKER" | grep -qx "$p"; then
      first_free="$p"; break
    fi
  done
  if [ -n "$first_free" ]; then
    echo "  -> first free candidate: $first_free"
  else
    echo "  -> none of the candidates are free; widen the list before asking infra"
  fi
}

echo "host: $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "date: $(date -Is)"

case "$ROLE" in
  backend)  report "BACKEND candidates (container listens on 5001)" "$BACKEND_CANDIDATES" ;;
  frontend) report "FRONTEND candidates (container listens on 3001)" "$FRONTEND_CANDIDATES" ;;
  *)
    report "BACKEND candidates (container listens on 5001)" "$BACKEND_CANDIDATES"
    report "FRONTEND candidates (container listens on 3001)" "$FRONTEND_CANDIDATES"
    ;;
esac

echo
echo "Everything currently listening on this host, for the infra request:"
if have ss; then
  ss -lntupH 2>/dev/null | awk '{split($5,a,":"); print a[length(a)], $NF}' | sort -un | head -40
else
  netstat -lntup 2>/dev/null | awk 'NR>2 {split($4,a,":"); print a[length(a)], $NF}' | sort -un | head -40
fi

echo
echo "Outbound reachability the deployment needs (a port being free locally is not enough):"
DB_HOST_CHECK="${DB_HOST:-pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com}"
if have nc; then
  nc -z -w5 "$DB_HOST_CHECK" 5432 >/dev/null 2>&1 \
    && echo "  RDS $DB_HOST_CHECK:5432 reachable" \
    || echo "  RDS $DB_HOST_CHECK:5432 NOT reachable - ask infra to whitelist this host in the Aliyun security group"
else
  timeout 5 bash -c "echo > /dev/tcp/$DB_HOST_CHECK/5432" 2>/dev/null \
    && echo "  RDS $DB_HOST_CHECK:5432 reachable" \
    || echo "  RDS $DB_HOST_CHECK:5432 NOT reachable - ask infra to whitelist this host in the Aliyun security group"
fi
