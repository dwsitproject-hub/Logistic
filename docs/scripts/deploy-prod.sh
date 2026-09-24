#!/usr/bin/env bash
#
# Deploy KLIP to production, with the checks that each cost us an outage.
#
#   cd /opt/klip && bash docs/scripts/deploy-prod.sh backend
#   cd /opt/klip && bash docs/scripts/deploy-prod.sh frontend
#
# Production is TWO hosts and they deploy separately:
#   backend  (ECS-DB)   API, migrations, every cron
#   frontend            Next.js, and every NEXT_PUBLIC_* flag
#
# WHY THIS EXISTS. The backend needs THREE compose files, and deploying with fewer fails silently:
#
#   docker-compose.backend.yml             base
#   docker-compose.backend.remote-db.yml   clears depends_on: postgres and pins DB_HOST/DB_PORT.
#                                          Without it a local postgres container is started on the
#                                          production host and DB_HOST falls back to klip-postgres.
#   docker-compose.backend.sap-share.yml   mounts IT's Synology share at /mnt/sap-import. Without
#                                          it the daily SAP import stops dead, and the only sign is
#                                          a log line at 06:00 the next morning.
#
# On 2026-09-24 production ran a deploy with only the base file and the SAP import stopped. Nothing
# errored. This script builds the file list itself, so it cannot be shortened by habit.
#
# It never edits .env, never runs migrations by hand (compose does that in the right order), and
# stops at the first failed check.

set -euo pipefail

ROLE="${1:-}"
BRANCH="${DEPLOY_BRANCH:-main}"

die() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

case "$ROLE" in
  backend|frontend) ;;
  *) die "usage: bash docs/scripts/deploy-prod.sh [backend|frontend]" ;;
esac

[[ -f .env ]] || die ".env not found. Run this from the deploy directory (usually /opt/klip)."
[[ -d .git ]] || die "no git repository here. Run this from the deploy directory."

if [[ "$ROLE" == "backend" ]]; then
  for f in docker-compose.backend.yml docker-compose.backend.remote-db.yml docker-compose.backend.sap-share.yml; do
    [[ -f "$f" ]] || die "$f is missing - deploying without it is what this script exists to prevent."
  done
  COMPOSE=(docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml -f docker-compose.backend.sap-share.yml)
  SERVICE=backend
  CONTAINER=klip-backend
else
  [[ -f docker-compose.frontend.yml ]] || die "docker-compose.frontend.yml is missing."
  COMPOSE=(docker compose -f docker-compose.frontend.yml)
  SERVICE=frontend
  CONTAINER=klip-frontend
fi

step "where we are"
printf '  host      : %s\n' "$(hostname)"
printf '  directory : %s\n' "$(pwd)"
printf '  role      : %s\n' "$ROLE"
printf '  branch    : %s\n' "$BRANCH"
printf '  commit    : %s\n' "$(git log --oneline -1)"
printf '  compose   : %s\n' "${COMPOSE[*]}"

# Column 1 of --porcelain is the index, column 2 the working tree. `git diff` reports only the
# working tree, which is how a STAGED edit made on the server survives a deploy unnoticed.
step "local changes to tracked files"
DIRTY="$(git status --porcelain | grep -v '^??' || true)"
if [[ -n "$DIRTY" ]]; then
  printf '%s\n' "$DIRTY" | sed 's/^/    /'
  die "tracked files are modified or staged here. Resolve them first - never with 'git stash'."
fi
printf '  none - only untracked files, which a pull will not touch\n'

step "fetching origin/$BRANCH"
git fetch origin "$BRANCH" --quiet
INCOMING="$(git log --oneline "HEAD..origin/$BRANCH" || true)"
if [[ -z "$INCOMING" ]]; then
  printf '  already up to date - nothing to pull\n'
else
  printf '%s\n' "$INCOMING" | sed 's/^/    /'
  printf '\n  files:\n'
  git diff --stat "HEAD..origin/$BRANCH" | tail -20 | sed 's/^/    /' || true
fi

MIGRATIONS="$(git diff --name-only "HEAD..origin/$BRANCH" -- backend/src/database/migrations/ || true)"
if [[ -n "$MIGRATIONS" ]]; then
  printf '\n  NEW OR CHANGED MIGRATIONS - these run against the production database:\n'
  printf '%s\n' "$MIGRATIONS" | sed 's/^/    /'
  printf '  Do not run them by hand. `compose up --build` runs them, then starts the matching code.\n'
fi

if [[ "$ROLE" == "backend" ]]; then
  step "database this backend will write to"
  DB_HOST_VALUE="$(grep -E '^DB_HOST=' .env | tail -n 1 | cut -d= -f2- || true)"
  printf '  DB_HOST (.env)    : %s\n' "${DB_HOST_VALUE:-(not set)}"
  [[ -n "$DB_HOST_VALUE" ]] \
    || die "DB_HOST is empty in .env. It would fall back to the local klip-postgres container."
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    printf '  DB_HOST (running) : %s\n' "$(docker exec "$CONTAINER" printenv DB_HOST 2>/dev/null || echo '(unreadable)')"
  fi
fi

if [[ "${DEPLOY_FORCE:-}" != "1" ]]; then
  printf '\n  This deploys to PRODUCTION. Type the role name to continue (expected: %s): ' "$ROLE"
  read -r CONFIRM
  [[ "${CONFIRM,,}" == "$ROLE" ]] || die "aborted - nothing deployed"
fi

IMAGE_BEFORE="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"

step "pulling"
git pull --ff-only origin "$BRANCH"

step "building and starting $SERVICE"
"${COMPOSE[@]}" up -d --build "$SERVICE"

IMAGE_AFTER="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"
if [[ "$IMAGE_BEFORE" == "$IMAGE_AFTER" && -n "$INCOMING" ]]; then
  printf '\n  WARNING: the image id did not change although commits were pulled.\n'
  printf '  On the frontend this usually means a NEXT_PUBLIC_* value never reached the build -\n'
  printf '  Docker drops a build arg the Dockerfile does not declare, silently, and leaves the\n'
  printf '  cache valid. Check that frontend/Dockerfile has an ARG for it, not only compose.\n'
fi

step "waiting for the container to finish starting"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" logs --tail=400 "$SERVICE" 2>/dev/null \
      | grep -qE "Database connected successfully|ready - started server|Listening on"; then
    break
  fi
  sleep 3
done

step "checks"
FAILED=0
ok()   { printf '  [ OK ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; FAILED=1; }
logs() { "${COMPOSE[@]}" logs --tail=800 "$SERVICE" 2>/dev/null; }

if docker exec "$CONTAINER" true >/dev/null 2>&1; then ok "container is running"; else bad "container is running"; fi

if [[ "$ROLE" == "backend" ]]; then
  if logs | grep -qiE 'migration.*(failed|error)'; then bad "no migration errors this boot"; else ok "no migration errors this boot"; fi
  if logs | grep -qi 'SAP folder auto-import cron scheduled'; then ok "SAP auto-import cron registered"; else bad "SAP auto-import cron registered"; fi
  if docker exec "$CONTAINER" sh -c 'ls "/mnt/sap-import/ORIGINAL" >/dev/null 2>&1'; then
    ok "SAP share mounted and readable"
  else
    bad "SAP share mounted and readable (check KLIP_SAP_IMPORT_MOUNT points at a path that exists)"
  fi

  printf '\n  Crons registered this boot:\n'
  logs | grep -iE "cron scheduled|cron is disabled" | tail -12 | sed 's/^/    /' || true
  printf '\n  SAP auto-import lines:\n'
  logs | grep -i "auto-import" | tail -4 | sed 's/^/    /' || true
else
  printf '\n  NEXT_PUBLIC_* from .env - these are baked in at BUILD time, so a value changed here\n'
  printf '  only takes effect on a build that was not fully cached:\n'
  grep -E '^NEXT_PUBLIC_' .env | sed 's/^/    /' || printf '    (none)\n'
fi

step "result"
printf '  commit now : %s\n' "$(git log --oneline -1)"
if [[ "$FAILED" -eq 0 ]]; then
  printf '  all checks passed\n\n'
else
  printf '  ONE OR MORE CHECKS FAILED - read the lines above before walking away\n\n'
  exit 1
fi
