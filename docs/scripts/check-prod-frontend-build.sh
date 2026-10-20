#!/usr/bin/env bash
#
# READ-ONLY: which frontend build is the production site serving, since when, and does it carry the two fixes of 2026-10-19?
#
#   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/check-prod-frontend-build.sh | bash
#   ... | bash -s -- --chunk=page-38b7f1f1700bd429.js          (a chunk named in a JS error trace; the default)
#
# Run it on ECS-App (the frontend host). It changes nothing, restarts nothing and needs no .env.
#
# WHY. The Hub (Bug reports & errors) lists React #423 and a CanceledError from commercial-documents. Their analysis describes code that was fixed on 2026-10-19
# (f7a963f0 hydration of <Layout>, e0bd2abe a cancelled list refresh no longer escapes). Whether a given report is a LIVE problem depends on the build that sent it:
# a tab left open since before the deploy keeps running its old JavaScript and keeps reporting. Every report carries a release (the git SHA the bundle was built
# from, NEXT_PUBLIC_GIT_SHA) - this prints the release the site serves now, when its image was built, and whether the trace's chunk still exists.
#
# Times are printed in UTC and in WIB: the host and the container log in UTC, the Hub shows "6 h ago".

set -u

CHUNK="page-38b7f1f1700bd429.js"
for a in "$@"; do
  case "$a" in
    --chunk=*) CHUNK="${a#--chunk=}" ;;
  esac
done

CONTAINER="${KLIP_FRONTEND_CONTAINER:-klip-frontend}"
APP_DIR="${APP_DIR:-/opt/klip}"
FIX_HYDRATION="f7a963f0"   # fix(layout): the first client render matches the server's "Loading..."
FIX_CANCEL="e0bd2abe"      # fix(commercial-documents): a failed or cancelled list refresh no longer escapes
CANCEL_MARKER="Could not refresh the list"   # a string only the build after e0bd2abe carries

# WIB is UTC+7 with no daylight saving: add the hours instead of trusting TZ=Asia/Jakarta, which silently falls back to UTC when the host has no tzdata.
# Seconds arithmetic, not "<time> +7 hours": GNU date reads that "+7" as a timezone when the input carries no zone (it printed 02:39 for 08:39 UTC).
wib() { date -u -d "@$(( $(date -u -d "$1" +%s) + 25200 ))" '+%Y-%m-%d %H:%M WIB' 2>/dev/null || echo "$1"; }
hr() { printf '\n== %s\n' "$*"; }

hr "where we are"
printf '  host      : %s\n' "$(hostname)"
printf '  now       : %s UTC   %s\n' "$(date -u '+%Y-%m-%d %H:%M')" "$(wib "$(date -u '+%Y-%m-%d %H:%M:%S')")"
if [ ! -d "$APP_DIR/.git" ]; then
  printf '  no git checkout at %s - skipping the checkout checks\n' "$APP_DIR"
  HEAD_SHA=""
else
  HEAD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  printf '  checkout  : %s   %s   (%s)\n' "$HEAD_SHA" "$(git -C "$APP_DIR" log -1 --format=%s 2>/dev/null | cut -c1-80)" "$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  printf '  committed : %s\n' "$(git -C "$APP_DIR" log -1 --format=%cd --date=iso 2>/dev/null)"
  for fix in "$FIX_HYDRATION:hydration (Layout)" "$FIX_CANCEL:cancelled refresh (commercial-documents)"; do
    sha="${fix%%:*}"; label="${fix#*:}"
    if git -C "$APP_DIR" merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
      printf '  checkout contains %s %s: yes\n' "$sha" "$label"
    else
      printf '  checkout contains %s %s: NO\n' "$sha" "$label"
    fi
  done
fi

hr "the running container"
if ! command -v docker >/dev/null 2>&1 || ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  printf '  container %s not found - is this ECS-App? (ECS-DB runs the backend, not the frontend)\n' "$CONTAINER"
  exit 0
fi
IMAGE_ID="$(docker inspect -f '{{.Image}}' "$CONTAINER" | cut -c8-19)"
IMAGE_CREATED="$(docker image inspect -f '{{.Created}}' "$(docker inspect -f '{{.Image}}' "$CONTAINER")" 2>/dev/null || true)"
STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")"
printf '  state     : %s\n' "$(docker inspect -f '{{.State.Status}}' "$CONTAINER")"
printf '  image     : %s\n' "$IMAGE_ID"
# Docker prints the image's Created time in the HOST's zone (+08:00 on ECS-App), so convert it instead of relabelling the digits as UTC (it once read 18:19 UTC for a 10:19 UTC build).
utc() { date -u -d "$1" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$1"; }
printf '  image built : %s UTC   %s\n' "$(utc "$IMAGE_CREATED")" "$(wib "$IMAGE_CREATED")"
printf '  started     : %s UTC   %s\n' "$(utc "$STARTED")" "$(wib "$STARTED")"
BUILD_ID_TIME="$(docker exec "$CONTAINER" sh -c 'stat -c %y .next/BUILD_ID 2>/dev/null' 2>/dev/null | cut -c1-16)"
[ -n "$BUILD_ID_TIME" ] && printf '  .next/BUILD_ID written : %s\n' "$BUILD_ID_TIME"

hr "the release the site serves (the SHA that every error report carries)"
PORT="$(docker port "$CONTAINER" 2>/dev/null | head -1 | sed 's/.*://')"
BASE="http://127.0.0.1:${PORT:-80}"
RELEASE="$(curl -s --max-time 10 "$BASE/login" | grep -o 'data-release="[^"]*"' | head -1 | sed 's/data-release="\(.*\)"/\1/')"
if [ -n "$RELEASE" ]; then
  printf '  data-release : %s   (served by %s)\n' "$RELEASE" "$BASE"
  if [ -n "$HEAD_SHA" ]; then
    if [ "$RELEASE" = "$HEAD_SHA" ]; then
      printf '  matches the checkout HEAD (%s): yes - the image was built from the code now on disk\n' "$HEAD_SHA"
    else
      printf '  matches the checkout HEAD (%s): NO - the checkout is at %s but the site serves %s\n' "$HEAD_SHA" "$HEAD_SHA" "$RELEASE"
      printf '     (pulled and not rebuilt, or rebuilt from a different commit)\n'
    fi
    if git -C "$APP_DIR" cat-file -e "$RELEASE^{commit}" 2>/dev/null; then
      for fix in "$FIX_HYDRATION:hydration (Layout)" "$FIX_CANCEL:cancelled refresh"; do
        sha="${fix%%:*}"; label="${fix#*:}"
        if git -C "$APP_DIR" merge-base --is-ancestor "$sha" "$RELEASE" 2>/dev/null; then
          printf '  release %s contains %s %s: yes\n' "$RELEASE" "$sha" "$label"
        else
          printf '  release %s contains %s %s: NO\n' "$RELEASE" "$sha" "$label"
        fi
      done
    else
      printf '  (release %s is not a commit this checkout knows - git fetch origin main first)\n' "$RELEASE"
    fi
  fi
else
  printf '  no data-release in the served HTML: the bundle was built WITHOUT a release (NEXT_PUBLIC_GIT_SHA empty), so reports cannot be tied to a version\n'
fi

hr "the build itself (strings, not commits)"
if docker exec "$CONTAINER" sh -c "grep -rl '$CANCEL_MARKER' .next/static 2>/dev/null | head -1" 2>/dev/null | grep -q .; then
  printf '  carries the cancelled-refresh fix (\"%s\"): yes\n' "$CANCEL_MARKER"
else
  printf '  carries the cancelled-refresh fix (\"%s\"): NO\n' "$CANCEL_MARKER"
fi

hr "the chunk named in the trace: $CHUNK"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/_next/static/chunks/app/commercial-documents/$CHUNK")"
INSIDE="$(docker exec "$CONTAINER" sh -c "ls .next/static/chunks/app/commercial-documents/ 2>/dev/null" 2>/dev/null | tr '\n' ' ')"
printf '  GET %s -> %s\n' "/_next/static/chunks/app/commercial-documents/$CHUNK" "$CODE"
printf '  commercial-documents chunks in this build: %s\n' "${INSIDE:-none found}"
if [ "$CODE" = "404" ]; then
  printf '  -> that chunk belongs to a build that is gone: a report naming it came from a tab or cache that predates this build\n'
elif [ "$CODE" = "200" ]; then
  printf '  -> that chunk is still served: a report naming it came from THIS build\n'
fi

hr "reading it"
cat <<'EOF'
  - A Hub error whose release is this release (or newer) is LIVE: both fixes of 2026-10-19 are in the build, so look at the report, not at the tab.
  - A Hub error whose release is older than the fixes, or whose chunk is gone (404 above), is a tab or cache from before the deploy: a hard reload ends it.
  - If "matches the checkout HEAD" says NO, the site is not running the code on disk: the frontend needs a rebuild (docs/scripts/deploy-prod-frontend.sh), not a fix.
EOF
