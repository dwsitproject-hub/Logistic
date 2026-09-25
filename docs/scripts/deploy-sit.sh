#!/usr/bin/env bash
#
# Deploy KLIP to SIT.
#
#   cd /opt/klip && bash docs/scripts/deploy-sit.sh backend
#   cd /opt/klip && bash docs/scripts/deploy-sit.sh frontend
#
# SIT IS TWO HOSTS and they deploy separately. Running a role on the wrong host fails at the
# first step with "env file /opt/klip/backend/.env not found", which reads like a broken repo
# rather than the real cause:
#
#   backend   172.28.92.57   iZk1a4m0oobaw170notm7pZ   API, migrations, every cron
#   frontend  172.28.92.56   iZk1a5ja5hi7ps6aa7x88rZ   Next.js, and every NEXT_PUBLIC_* flag
#
# Each host has its own /opt/klip/.env. docs/DEPLOY-SIT-GITHUB.md still describes a single-host
# deploy and is misleading.
#
# WHY THIS EXISTS, beyond saving typing:
#
#   1. The backend needs docker-compose.backend.remote-db.yml. Without it compose starts a
#      co-located klip-postgres and DB_HOST falls back to it, so the deploy "works" against an
#      empty database.
#   2. A NEXT_PUBLIC_* value is read by Next.js at BUILD time. Docker SILENTLY DROPS a build arg
#      the Dockerfile does not declare - and, because the arg never enters the build graph, it
#      does not invalidate the cache either. The rebuild then reports every layer CACHED and the
#      container Running rather than Recreated: indistinguishable from a successful no-op deploy.
#      NEXT_PUBLIC_JPS_ENABLED was missing its ARG for days while .env said true, and the Jetty
#      columns were compiled out of every build. This script checks both directions before it
#      builds, and reports whether the image actually changed afterwards.
#
# It never edits .env, never runs migrations by hand (compose does that in the right order, then
# starts the matching code), and stops at the first failed check.
#
# Sibling script: docs/scripts/deploy-prod.sh - same shape, and production additionally needs
# docker-compose.backend.sap-share.yml.

set -euo pipefail

ROLE="${1:-}"
BRANCH="${DEPLOY_BRANCH:-SIT}"

die()  { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

case "$ROLE" in
  backend|frontend) ;;
  *) die "usage: bash docs/scripts/deploy-sit.sh [backend|frontend]" ;;
esac

[[ -f .env ]] || die ".env not found. Run this from the deploy directory (usually /opt/klip)."
[[ -d .git ]] || die "no git repository here. Run this from the deploy directory."

if [[ "$ROLE" == "backend" ]]; then
  [[ -f docker-compose.backend.yml ]] || die "docker-compose.backend.yml is missing."
  [[ -f docker-compose.backend.remote-db.yml ]] \
    || die "docker-compose.backend.remote-db.yml is missing - without it compose starts a local postgres and the backend talks to an empty database."
  COMPOSE=(docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml)

  # SIT usually has no SAP share. Add it only when .env asks for one AND the host path is really
  # there, because a bind mount to a path that does not exist gives the container an empty folder
  # and no error at all - the failure mode that stopped production's daily import.
  SAP_MOUNT="$(grep -E '^KLIP_SAP_IMPORT_MOUNT=' .env | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//' || true)"
  if [[ -n "${SAP_MOUNT:-}" && -f docker-compose.backend.sap-share.yml ]]; then
    if [[ -d "$SAP_MOUNT" ]]; then
      COMPOSE+=(-f docker-compose.backend.sap-share.yml)
    else
      printf '\n  NOTE: KLIP_SAP_IMPORT_MOUNT is set but does not exist on this host:\n    %s\n' "$SAP_MOUNT"
      printf '  Deploying WITHOUT the SAP share rather than binding an empty folder.\n'
    fi
  fi

  SERVICE=backend
  CONTAINER=klip-backend
  EXPECT_HOST_HINT="172.28.92.57 / iZk1a4m0oobaw170notm7pZ"
else
  [[ -f docker-compose.frontend.yml ]] || die "docker-compose.frontend.yml is missing."
  COMPOSE=(docker compose -f docker-compose.frontend.yml)
  SERVICE=frontend
  CONTAINER=klip-frontend
  EXPECT_HOST_HINT="172.28.92.56 / iZk1a5ja5hi7ps6aa7x88rZ"
fi

step "where we are"
printf '  host      : %s   (expected for %s: %s)\n' "$(hostname)" "$ROLE" "$EXPECT_HOST_HINT"
printf '  directory : %s\n' "$(pwd)"
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
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  printf '  on %s, switching to %s\n' "$CURRENT_BRANCH" "$BRANCH"
  git checkout "$BRANCH"
fi

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
  printf '\n  NEW OR CHANGED MIGRATIONS - these run against the SIT database:\n'
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
else
  # The ARG trap, checked BEFORE the build rather than puzzled over after it. Both directions
  # matter: compose must pass the value, and the Dockerfile must declare it. Either half missing
  # means the flag is silently absent from the bundle while .env looks correct.
  step "NEXT_PUBLIC_* wiring (build-time, so a missing link is invisible at runtime)"
  MISSING_WIRING=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    KEY="${line%%=*}"
    VALUE="${line#*=}"
    NOTE=""
    grep -qE "^[[:space:]]*ARG[[:space:]]+${KEY}([=[:space:]]|$)" frontend/Dockerfile \
      || { NOTE="  <-- no ARG in frontend/Dockerfile: Docker will DROP it"; MISSING_WIRING=1; }
    if [[ -z "$NOTE" ]]; then
      grep -qE "^[[:space:]]*${KEY}:" docker-compose.frontend.yml \
        || { NOTE="  <-- not under args: in docker-compose.frontend.yml: never passed to the build"; MISSING_WIRING=1; }
    fi
    printf '    %s=%s%s\n' "$KEY" "$VALUE" "$NOTE"
  done < <(grep -E '^NEXT_PUBLIC_' .env || true)
  [[ "$MISSING_WIRING" -eq 0 ]] \
    || die "a NEXT_PUBLIC_* value in .env cannot reach the build. Fix the wiring first, or this deploy will report success and change nothing."
  printf '  every NEXT_PUBLIC_* in .env reaches the build\n'
fi

IMAGE_BEFORE="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"

step "pulling"
git pull --ff-only origin "$BRANCH"

step "building and starting $SERVICE"
"${COMPOSE[@]}" up -d --build "$SERVICE"

IMAGE_AFTER="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"
step "did the image actually change"
printf '  before : %s\n' "$IMAGE_BEFORE"
printf '  after  : %s\n' "$IMAGE_AFTER"
if [[ "$IMAGE_BEFORE" == "$IMAGE_AFTER" && -n "$INCOMING" ]]; then
  printf '  WARNING: unchanged although commits were pulled. On the frontend this is the usual\n'
  printf '  sign that a build arg never reached the builder. The wiring check above passed, so\n'
  printf '  look next at whether the pulled commits touch frontend/ at all.\n'
elif [[ "$IMAGE_BEFORE" == "$IMAGE_AFTER" ]]; then
  printf '  unchanged, and nothing was pulled - consistent\n'
else
  printf '  changed - the running container is the code just built\n'
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
  if curl -sf "http://127.0.0.1:5001/health" >/dev/null; then ok "/health answers on 127.0.0.1:5001"; else bad "/health answers on 127.0.0.1:5001"; fi

  printf '\n  Crons registered this boot:\n'
  logs | grep -iE "cron scheduled|cron is disabled" | tail -12 | sed 's/^/    /' || true
  printf '\n  JPS lines (SIT is where JPS is tested):\n'
  logs | grep -iE "jps" | tail -6 | sed 's/^/    /' || printf '    (none)\n'
else
  # A static check cannot prove a value is baked in; only a string the new code contains can.
  # Print the command rather than guessing a string here.
  printf '\n  To prove the new UI is really in the bundle, grep the build for a string only the\n'
  printf '  new code contains:\n'
  printf '    docker compose -f docker-compose.frontend.yml exec -T frontend \\n'
  printf '      sh -c "grep -rl '"'"'<a string only the new code has'"'"' .next/static | head -3"\n'
fi

step "result"
printf '  commit now : %s\n' "$(git log --oneline -1)"
if [[ "$FAILED" -eq 0 ]]; then
  printf '  all checks passed\n\n'
else
  printf '  ONE OR MORE CHECKS FAILED - read the lines above before walking away\n\n'
  exit 1
fi
