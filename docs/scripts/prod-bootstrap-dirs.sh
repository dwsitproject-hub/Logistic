#!/usr/bin/env bash
# Create the production directory layout on a fresh server, same shape as staging (/opt/klip).
#
#   sudo bash prod-bootstrap-dirs.sh backend     # on 172.28.80.51
#   sudo bash prod-bootstrap-dirs.sh frontend    # on 172.28.80.50
#
# Idempotent: safe to re-run. Creates nothing that already exists, and never overwrites .env.
# Does NOT clone the repository or start anything - see docs/DEPLOY-PRODUCTION.md for the order.

set -euo pipefail

ROLE="${1:-}"
if [ "$ROLE" != "backend" ] && [ "$ROLE" != "frontend" ]; then
  echo "usage: sudo bash prod-bootstrap-dirs.sh {backend|frontend}" >&2
  exit 2
fi

ROOT=/opt/klip

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: /opt is not writable by a normal user." >&2
  exit 1
fi

echo "== creating $ROOT layout for role: $ROLE =="
mkdir -p "$ROOT"

# Owned by the invoking (non-root) user where possible, so `git pull` later does not need sudo.
OWNER="${SUDO_USER:-root}"
OWNER_GROUP="$(id -gn "$OWNER" 2>/dev/null || echo root)"

if [ "$ROLE" = "backend" ]; then
  # Bind mounts the backend compose file expects. Without these, Docker creates them as
  # root-owned directories and the container cannot write uploads or logs.
  mkdir -p "$ROOT/backend/uploads" "$ROOT/backend/logs"
  # The container runs as a non-root user; uploads and logs must be writable by it. 777 is
  # deliberate on a bind mount whose uid inside the container is not knowable from here - tighten
  # to the container uid once `docker compose exec backend id -u` is known.
  chmod 0777 "$ROOT/backend/uploads" "$ROOT/backend/logs"
  echo "  created $ROOT/backend/uploads and $ROOT/backend/logs"
fi

mkdir -p "$ROOT/backups"
chmod 0750 "$ROOT/backups"
echo "  created $ROOT/backups"

chown -R "$OWNER:$OWNER_GROUP" "$ROOT" 2>/dev/null || true
echo "  owner set to $OWNER:$OWNER_GROUP"

# .env holds the database password, so it is created empty with restrictive permissions rather
# than from a template - a template invites committing or leaving placeholder credentials.
if [ ! -f "$ROOT/.env" ]; then
  install -m 0600 -o "$OWNER" -g "$OWNER_GROUP" /dev/null "$ROOT/.env"
  echo "  created empty $ROOT/.env (0600) - fill it per docs/DEPLOY-PRODUCTION.md"
else
  echo "  $ROOT/.env already exists - left untouched"
fi

echo
echo "== result =="
ls -la "$ROOT"
echo
echo "Next: fill $ROOT/.env, then clone the repository into $ROOT."
echo "DB_HOST must be set explicitly - the compose overlay defaults to the SIT database."
