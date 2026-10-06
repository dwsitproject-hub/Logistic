#!/usr/bin/env bash
#
# Deploy the KLIP FRONTEND (Next.js) to production, with the checks that each cost us an outage.
#
#   cd /opt/klip && bash docs/scripts/deploy-prod-frontend.sh
#
# Run it on ECS-App (147.139.176.70, SSH 1818), never on ECS-DB. The backend deploys separately, on
# the other host: docs/scripts/deploy-prod-backend.sh. Backend first when a release carries
# migrations.
#
# WHY THIS EXISTS. Every NEXT_PUBLIC_* value is baked into the bundle at BUILD time. A value in .env
# that the Dockerfile has no ARG for, or that docker-compose.frontend.yml does not pass under
# `args:`, is silently dropped, and the rebuild reports success while changing nothing. This script
# checks that wiring before the build rather than puzzling over it after.
#
# It never edits .env and stops at the first failed check.
#
# This file is self-contained on purpose: it is fetched with `git show origin/main:<path> > /tmp/...`
# before the checkout is pulled, so it cannot rely on a sibling file being next to it. The backend
# script repeats the shared checks (clean tree, fetch, destructive-migration list, confirmation).

set -euo pipefail

# The whole script is the body of main(), called on the LAST line together with `exit`.
#
# Bash reads a script from disk as it runs, not all at once. If the file is OVERWRITTEN IN PLACE
# mid-run - `cp` over it, `cat >`, editing it with nano on the server - bash carries on from its
# old byte offset in the new content and runs fragments of lines. `git pull` is NOT that case - git
# writes a new file and renames it. Wrapped in a function, bash must read the whole definition
# before running any of it, and `exit` on the call's line stops it reading further.
main() {

ROLE=frontend
BRANCH="${DEPLOY_BRANCH:-main}"

die() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

[[ -f .env ]] || die ".env not found. Run this from the deploy directory (usually /opt/klip)."
[[ -d .git ]] || die "no git repository here. Run this from the deploy directory."

[[ -f docker-compose.frontend.yml ]] || die "docker-compose.frontend.yml is missing."
COMPOSE=(docker compose -f docker-compose.frontend.yml)
SERVICE=frontend
CONTAINER=klip-frontend

# Two hosts, one checkout each. Both have /opt/klip and every compose file, so a wrong-host run
# passes every file check and reaches the build: on 2026-09-30 a frontend deploy was started on
# ECS-DB and stopped only at the confirmation prompt. The backend host is named ECS-DB.
HOST_NAME="$(hostname)"
if [[ "$HOST_NAME" == "ECS-DB" ]]; then
  die "this is ECS-DB, the BACKEND host. Run the frontend deploy on ECS-App (147.139.176.70, SSH 1818)."
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
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] \
  || die "this checkout is on $CURRENT_BRANCH, not $BRANCH. Production is not switched by a script - find out why first."
INCOMING="$(git log --oneline "HEAD..origin/$BRANCH" || true)"
if [[ -z "$INCOMING" ]]; then
  printf '  already up to date - nothing to pull\n'
else
  printf '%s\n' "$INCOMING" | sed 's/^/    /'
  printf '\n  files:\n'
  git diff --stat "HEAD..origin/$BRANCH" | tail -20 | sed 's/^/    /' || true
fi

# The frontend does not run migrations, but this host's checkout is the same repository, so a release
# that carries them is worth a reminder: they only run when the BACKEND deploys.
MIGRATIONS="$(git diff --name-only "HEAD..origin/$BRANCH" -- backend/src/database/migrations/ || true)"
if [[ -n "$MIGRATIONS" ]]; then
  printf '\n  This release carries migrations. They run when the BACKEND deploys, on ECS-DB:\n'
  printf '%s\n' "$MIGRATIONS" | sed 's/^/    /'
  printf '  Deploy the backend FIRST - a new UI on an old API shows empty or broken fields.\n'
fi

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

if [[ "${DEPLOY_FORCE:-}" != "1" ]]; then
  printf '\n  This deploys the FRONTEND to PRODUCTION. Type the role name to continue (expected: %s): ' "$ROLE"
  read -r CONFIRM
  [[ "${CONFIRM,,}" == "$ROLE" ]] || die "aborted - nothing deployed"
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
  printf '  WARNING: unchanged although commits were pulled. This is the usual sign that a build\n'
  printf '  arg never reached the builder. The wiring check above passed, so look next at whether\n'
  printf '  the pulled commits touch frontend/ at all.\n'
elif [[ "$IMAGE_BEFORE" == "$IMAGE_AFTER" ]]; then
  printf '  unchanged, and nothing was pulled - consistent\n'
else
  printf '  changed - the running container is the code just built\n'
fi

step "waiting for the container to finish starting"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" logs --tail=400 "$SERVICE" 2>/dev/null \
      | grep -qE "ready - started server|Listening on"; then
    break
  fi
  sleep 3
done

step "checks"
FAILED=0
ok()   { printf '  [ OK ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; FAILED=1; }

if docker exec "$CONTAINER" true >/dev/null 2>&1; then ok "container is running"; else bad "container is running"; fi

# A static check cannot prove a value is baked in; only a string the new code contains can.
printf '\n  To prove the new UI is really in the bundle, grep the build for a string only the\n'
printf '  new code contains:\n'
printf '    %s\n' "docker compose -f docker-compose.frontend.yml exec -T frontend sh -c \"grep -rl '<a string only the new code has>' .next | head -3\""

step "result"
printf '  commit now : %s\n' "$(git log --oneline -1)"
if [[ "$FAILED" -eq 0 ]]; then
  printf '  all checks passed\n\n'
else
  printf '  ONE OR MORE CHECKS FAILED - read the lines above before walking away\n\n'
  exit 1
fi
}

main "$@"; exit
