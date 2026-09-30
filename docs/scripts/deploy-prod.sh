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

# The whole script is the body of main(), called on the LAST line together with `exit`.
#
# Bash reads a script from disk as it runs, not all at once. If the file is OVERWRITTEN IN PLACE
# mid-run - `cp` over it, `cat >`, editing it with nano on the server - bash carries on from its
# old byte offset in the new content and runs fragments of lines. Tested: an in-place overwrite
# ran half a line and then the new file's commands. `git pull` is NOT that case - git writes a new
# file and renames it, so bash keeps reading the old one to the end (also tested, and what the SIT
# deploy of f05c662 showed). Wrapped in a function, bash must read the whole definition before
# running any of it, and `exit` on the call's line stops it reading further. Deliberately not
# re-indented, so the diff is the size of the change.
main() {

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

# Two hosts, one checkout each. Both have /opt/klip and every compose file, so a wrong-host run
# passes every file check and reaches the build: on 2026-09-30 a frontend deploy was started on
# ECS-DB and stopped only at the confirmation prompt. The backend host is named ECS-DB.
HOST_NAME="$(hostname)"
if [[ "$ROLE" == "frontend" && "$HOST_NAME" == "ECS-DB" ]]; then
  die "this is ECS-DB, the BACKEND host. Run the frontend deploy on ECS-App (147.139.176.70, SSH 1818)."
fi
if [[ "$ROLE" == "backend" && "$HOST_NAME" != "ECS-DB" && "${DEPLOY_ALLOW_HOST:-}" != "1" ]]; then
  die "this is $HOST_NAME, not ECS-DB. The backend deploys on ECS-DB (8.215.56.98, SSH 1819). DEPLOY_ALLOW_HOST=1 overrides if the host was renamed."
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

MIGRATIONS="$(git diff --name-only "HEAD..origin/$BRANCH" -- backend/src/database/migrations/ || true)"
if [[ -n "$MIGRATIONS" ]]; then
  printf '\n  NEW OR CHANGED MIGRATIONS - these run against the production database:\n'
  printf '%s\n' "$MIGRATIONS" | sed 's/^/    /'
  printf '  Do not run them by hand. `compose up --build` runs them, then starts the matching code.\n'
fi

# A migration that deletes or drops cannot be undone by going back to the old image: the rows are
# gone. Migrations 195-197 (DELETE FROM master_plants / master_loading_ports, then reload from the
# CPO workbook) were the first of these to reach production. List them, and print a backup statement per
# table so the backup takes one paste rather than a decision under time pressure.
DESTRUCTIVE=""
DESTRUCTIVE_TABLES=""
while IFS= read -r f; do
  if [[ -z "$f" ]]; then continue; fi
  BODY="$(git show "origin/$BRANCH:$f" 2>/dev/null || true)"
  HITS="$(printf '%s\n' "$BODY" \
    | grep -niE '^[[:space:]]*(DELETE[[:space:]]+FROM|TRUNCATE|DROP[[:space:]]+TABLE|ALTER[[:space:]]+TABLE.*DROP[[:space:]]+COLUMN)' || true)"
  if [[ -n "$HITS" ]]; then
    DESTRUCTIVE+="    ${f##*/}"$'\n'"$(printf '%s\n' "$HITS" | sed 's/^/        line /')"$'\n'
    DESTRUCTIVE_TABLES+="$(printf '%s\n' "$HITS" \
      | grep -oiE '(DELETE[[:space:]]+FROM|TRUNCATE([[:space:]]+TABLE)?)[[:space:]]+[a-z_][a-z0-9_.]*' \
      | awk '{print $NF}' || true)"$'\n'
  fi
done <<< "$MIGRATIONS"
if [[ -n "$DESTRUCTIVE" ]]; then
  step "MIGRATIONS THAT DELETE OR DROP DATA on production"
  printf '%s' "$DESTRUCTIVE"
  BACKUP_TABLES="$(printf '%s' "$DESTRUCTIVE_TABLES" | sed '/^$/d' | sort -u)"
  if [[ -n "$BACKUP_TABLES" ]]; then
    printf '\n  Backup, one statement per table:\n'
    while IFS= read -r t; do
      printf '    CREATE TABLE %s_bak_%s AS SELECT * FROM %s;\n' "${t//./_}" "$(date +%Y%m%d)" "$t"
    done <<< "$BACKUP_TABLES"
  fi
  if [[ "${DEPLOY_FORCE:-}" != "1" ]]; then
    printf '\n  Back those tables up first (psql on the production database), then type BACKED-UP.\n'
    printf '  Type SKIP-BACKUP to deploy without one: '
    read -r BACKUP_ANSWER
    case "${BACKUP_ANSWER^^}" in
      BACKED-UP|SKIP-BACKUP) ;;
      *) die "aborted - nothing deployed" ;;
    esac
  fi
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

  # INTEGRATION_SECRETS_KEY decrypts the DHM / JPS credentials saved from the Integrations menu.
  # Without it the backend still starts, but nothing can be saved there - so a warning, not a stop.
  # The value is never printed: only whether it is usable, and a short fingerprint so production and
  # SIT can be compared. They must DIFFER - a copied key makes one environment's database
  # readable with the other's.
  step "integration secrets key (backend/.env)"
  KEY_RAW="$(grep -E '^INTEGRATION_SECRETS_KEY=' backend/.env 2>/dev/null | tail -n 1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" || true)"
  KEY_FP=""
  if [[ -z "$KEY_RAW" ]]; then
    printf '  WARNING: not set. Saving DHM / JPS settings from the Integrations menu will fail.\n'
    printf '  Generate it straight into the file, without displaying it:\n'
    printf "    openssl rand -hex 32 | sed 's/^/INTEGRATION_SECRETS_KEY=/' >> backend/.env\n"
  elif [[ "$KEY_RAW" =~ ^[0-9a-fA-F]{64}$ ]] \
      || [[ "$(printf '%s' "$KEY_RAW" | base64 -d 2>/dev/null | wc -c)" -eq 32 ]]; then
    KEY_FP="$(printf '%s' "$KEY_RAW" | sha256sum | cut -c1-12)"
    printf '  set, 32 bytes. fingerprint %s - must NOT match SIT\n' "$KEY_FP"
  else
    printf '  WARNING: set but not 32 bytes (64 hex or base64). The backend treats it as not set.\n'
  fi
  unset KEY_RAW
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
  if logs | grep -qi 'SAP folder auto-import cron scheduled'; then ok "SAP auto-import cron registered"; else bad "SAP auto-import cron registered"; fi
  if docker exec "$CONTAINER" sh -c 'ls "/mnt/sap-import/ORIGINAL" >/dev/null 2>&1'; then
    ok "SAP share mounted and readable"
  else
    bad "SAP share mounted and readable (check KLIP_SAP_IMPORT_MOUNT points at a path that exists)"
  fi

  # docker-compose.backend.yml reads the key from env_file ONLY; a ${...:-} line would substitute an
  # empty string over it without a word. Compare fingerprints, never values.
  if [[ -n "$KEY_FP" ]]; then
    RUN_FP="$(docker exec "$CONTAINER" printenv INTEGRATION_SECRETS_KEY 2>/dev/null | tr -d '\r\n' | sha256sum | cut -c1-12 || true)"
    if [[ "$RUN_FP" == "$KEY_FP" ]]; then ok "container has the integration secrets key from backend/.env"; else bad "container has the integration secrets key from backend/.env"; fi
  fi

  printf '\n  Crons registered this boot:\n'
  logs | grep -iE "cron scheduled|cron is disabled" | tail -12 | sed 's/^/    /' || true
  printf '\n  SAP auto-import lines:\n'
  logs | grep -i "auto-import" | tail -4 | sed 's/^/    /' || true
else
  # A static check cannot prove a value is baked in; only a string the new code contains can.
  printf '\n  To prove the new UI is really in the bundle, grep the build for a string only the\n'
  printf '  new code contains:\n'
  printf '    %s\n' "docker compose -f docker-compose.frontend.yml exec -T frontend sh -c \"grep -rl '<a string only the new code has>' .next | head -3\""
fi

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
