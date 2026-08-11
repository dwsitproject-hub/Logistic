#!/usr/bin/env bash
# KLIP staging — backend deploy + DB migrate + trucking dedupe + master vessel import.
#
# Run on backend server (PuTTY → 172.28.92.57), from /opt/klip:
#   bash docs/scripts/staging-deploy-backend-full.sh
#
# Options:
#   --skip-deploy          Skip git pull + docker rebuild (post-data only)
#   --skip-dedupe          Skip trucking PO dedupe
#   --skip-master-vessel   Skip master vessel SQL import
#   --dedupe-dry-run       Preview dedupe only (no cancel)
#   --master-vessel-file PATH   Default: tmp/master_vessel_local_to_sit.sql
#
# Master vessel file must exist on this server (export from laptop first):
#   powershell -File docs/scripts/export-master-vessel-local.ps1
#   scp tmp/master_vessel_local_to_sit.sql ubuntu@172.28.92.57:/opt/klip/tmp/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SKIP_DEPLOY=false
SKIP_DEDUPE=false
SKIP_MASTER_VESSEL=false
DEDUPE_DRY_RUN=false
MASTER_VESSEL_FILE="${ROOT}/tmp/master_vessel_local_to_sit.sql"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deploy) SKIP_DEPLOY=true; shift ;;
    --skip-dedupe) SKIP_DEDUPE=true; shift ;;
    --skip-master-vessel) SKIP_MASTER_VESSEL=true; shift ;;
    --dedupe-dry-run) DEDUPE_DRY_RUN=true; shift ;;
    --master-vessel-file)
      MASTER_VESSEL_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

echo "========================================"
echo "KLIP SIT backend FULL deploy"
echo "  dir:    $ROOT"
echo "========================================"

if ! $SKIP_DEPLOY; then
  bash "$ROOT/docs/scripts/staging-deploy-backend.sh"
else
  echo "==> Skipping deploy (--skip-deploy)"
fi

COMPOSE=(docker compose -f docker-compose.backend.yml)

echo ""
echo "==> DB migrations (incl. master vessel 135/136)"
"${COMPOSE[@]}" exec -T backend node dist/database/migrate.js

if ! $SKIP_DEDUPE; then
  echo ""
  if $DEDUPE_DRY_RUN; then
    echo "==> Trucking PO dedupe (dry-run preview)"
    bash "$ROOT/docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh"
  else
    echo "==> Trucking PO dedupe (backup + apply all duplicate POs)"
    bash "$ROOT/docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh" --apply
    echo ""
    echo "==> Remove CANCELLED dedupe losers from Trucking view table / Cancelled card"
    if [[ -f "$ROOT/docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh" ]]; then
      bash "$ROOT/docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh" --apply
    else
      echo "WARN: run-remove-cancelled-trucking-dedupe-losers-staging.sh not found — skip cleanup"
    fi
  fi
else
  echo "==> Skipping trucking dedupe (--skip-dedupe)"
fi

if ! $SKIP_MASTER_VESSEL; then
  echo ""
  if [[ -f "$MASTER_VESSEL_FILE" ]]; then
    echo "==> Master vessel import: $MASTER_VESSEL_FILE"
    bash "$ROOT/docs/scripts/sync-master-vessel-staging.sh" \
      --file "$MASTER_VESSEL_FILE" \
      --apply
  else
    echo "WARN: Master vessel SQL not found: $MASTER_VESSEL_FILE"
    echo "  Laptop:  powershell -ExecutionPolicy Bypass -File docs/scripts/export-master-vessel-local.ps1"
    echo "  Upload:  scp tmp/master_vessel_local_to_sit.sql ubuntu@172.28.92.57:/opt/klip/tmp/"
    echo "  Re-run:  bash docs/scripts/staging-deploy-backend-full.sh --skip-deploy"
  fi
else
  echo "==> Skipping master vessel import (--skip-master-vessel)"
fi

echo ""
echo "========================================"
echo "Backend FULL deploy done."
echo "  Next: deploy frontend on 172.28.92.56"
echo "    bash docs/scripts/staging-deploy-frontend.sh"
echo "  Verify:"
echo "    http://8.215.6.189/api/health"
echo "    http://8.215.6.189/trucking  (re-upload WB)"
echo "    http://8.215.6.189/master-vessel"
echo "========================================"
