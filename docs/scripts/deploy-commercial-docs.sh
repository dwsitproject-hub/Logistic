#!/usr/bin/env bash
#
# Deploy the Commercial Documents front end (frontend-commercial/) on the KLIP FRONTEND host.
#
#   cd /opt/klip && bash docs/scripts/deploy-commercial-docs.sh sit     # SIT frontend host 172.28.92.56, branch SIT
#   cd /opt/klip && bash docs/scripts/deploy-commercial-docs.sh prod    # ECS-App, branch main
#
# The app has no backend of its own: it calls the KLIP backend through Nginx (/api, /auth). Deploy the BACKEND first when the
# release changes backend/ - this script only rebuilds the klip-commercial-docs container and never touches klip-frontend.
#
# Self-contained on purpose (fetched with `git show origin/<branch>:<path> > /tmp/...` before the pull), and wrapped in main()
# so an in-place overwrite mid-run cannot make bash execute fragments - see deploy-prod-frontend.sh for both reasons.

set -euo pipefail

main() {

TARGET="${1:-}"
case "$TARGET" in
  sit) BRANCH="${DEPLOY_BRANCH:-SIT}" ;;
  prod) BRANCH="${DEPLOY_BRANCH:-main}" ;;
  *) printf '\n  usage: bash docs/scripts/deploy-commercial-docs.sh sit|prod\n\n' >&2; exit 1 ;;
esac

die() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

[[ -f .env ]] || die ".env not found. Run this from the deploy directory (usually /opt/klip)."
[[ -d .git ]] || die "no git repository here. Run this from the deploy directory."

# The backend hosts have the same checkout; building this there would publish nothing useful and waste the build.
case "$(hostname)" in
  ECS-DB|iZk1a4m0oobaw170notm7pZ) die "this is a BACKEND host ($(hostname)). Run this on the frontend host." ;;
esac

COMPOSE_FILE=docker-compose.frontend-commercial.yml
SERVICE=frontend-commercial
CONTAINER=klip-commercial-docs

step "where we are"
printf '  host      : %s\n' "$(hostname)"
printf '  directory : %s\n' "$(pwd)"
printf '  target    : %s (branch %s)\n' "$TARGET" "$BRANCH"
printf '  commit    : %s\n' "$(git log --oneline -1)"

step "local changes to tracked files"
DIRTY="$(git status --porcelain | grep -v '^??' || true)"
if [[ -n "$DIRTY" ]]; then
  printf '%s\n' "$DIRTY" | sed 's/^/    /'
  die "tracked files are modified or staged here. Resolve them first - never with 'git stash'."
fi
printf '  none\n'

step "fetching origin/$BRANCH"
git fetch origin "$BRANCH" --quiet
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  [[ "$TARGET" == "sit" ]] || die "this checkout is on $CURRENT_BRANCH, not $BRANCH. Production is not switched by a script."
  printf '  on %s, switching to %s\n' "$CURRENT_BRANCH" "$BRANCH"
  git checkout "$BRANCH"
fi
INCOMING="$(git log --oneline "HEAD..origin/$BRANCH" || true)"
if [[ -z "$INCOMING" ]]; then
  printf '  already up to date\n'
else
  printf '%s\n' "$INCOMING" | sed 's/^/    /'
  BACKEND_CHANGES="$(git diff --name-only "HEAD..origin/$BRANCH" -- backend/ | head -5 || true)"
  if [[ -n "$BACKEND_CHANGES" ]]; then
    printf '\n  This release also changes backend/ - it reaches users only when the BACKEND host deploys:\n'
    printf '%s\n' "$BACKEND_CHANGES" | sed 's/^/    /'
  fi
fi

step "settings from .env"
env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//' || true; }
PORT_MAP="$(env_value COMMERCIAL_DOCS_PORT)"
printf '  COMMERCIAL_DOCS_PORT            = %s\n' "${PORT_MAP:-127.0.0.1:3002 (default: only Nginx can reach it)}"
printf '  COMMERCIAL_BACKEND_INTERNAL_URL = %s\n' "$(env_value COMMERCIAL_BACKEND_INTERNAL_URL || true)"
printf '  COMMERCIAL_KLIP_URL             = %s\n' "$(env_value COMMERCIAL_KLIP_URL || true)"
if [[ -z "$(env_value COMMERCIAL_BACKEND_INTERNAL_URL)" && "${PORT_MAP:-}" != 127.0.0.1:* && -n "${PORT_MAP:-}" ]]; then
  printf '\n  NOTE: the container is published on %s without COMMERCIAL_BACKEND_INTERNAL_URL - that only works when Nginx\n' "$PORT_MAP"
  printf '  proxies /api and /auth on that port. Without Nginx, set COMMERCIAL_BACKEND_INTERNAL_URL (build-time).\n'
fi

if [[ "${DEPLOY_FORCE:-}" != "1" ]]; then
  printf '\n  This deploys Commercial Documents to %s. Type "commercial" to continue: ' "${TARGET^^}"
  read -r CONFIRM
  [[ "${CONFIRM,,}" == "commercial" ]] || die "aborted - nothing deployed"
fi

IMAGE_BEFORE="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"

step "pulling"
git pull --ff-only origin "$BRANCH"
[[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE is missing after the pull - is the app merged into $BRANCH?"

# The first SIT deploy (2026-10-26) ran before the compose file named its project, so that container belongs to project
# "klip". Compose will not take over a container_name owned by another project; remove it once so the new project can.
OWNER="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
if [[ -n "$OWNER" && "$OWNER" != "klip-commercial-docs" ]]; then
  printf '  removing %s from compose project "%s" (it moves to its own project)\n' "$CONTAINER" "$OWNER"
  docker rm -f "$CONTAINER" >/dev/null
fi

step "building and starting $SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --build "$SERVICE"

IMAGE_AFTER="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"
step "did the image change"
printf '  before : %s\n  after  : %s\n' "$IMAGE_BEFORE" "$IMAGE_AFTER"

step "waiting for the health check"
STATUS=unknown
for _ in $(seq 1 40); do
  STATUS="$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 3
done
printf '  %s\n' "$STATUS"

step "result"
printf '  commit now : %s\n' "$(git log --oneline -1)"
if [[ "$STATUS" == "healthy" ]]; then
  printf '  container healthy. Open the app (e.g. http://<this host>:8081/login) and sign in with a document-role account.\n\n'
else
  printf '  NOT HEALTHY - read: docker compose -f %s logs --tail=100 %s\n\n' "$COMPOSE_FILE" "$SERVICE"
  exit 1
fi
}

main "$@"; exit
