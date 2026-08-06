#!/usr/bin/env bash
# End-to-end BE fork migration orchestrator.
# Run on backend host (172.28.92.57), from /opt/klip:
#
#   bash docs/scripts/run-be-fork-migration.sh              # preview all phases
#   bash docs/scripts/run-be-fork-migration.sh --apply      # execute merge (after review)
#
# Environment:
#   BE_FORK_CUTOFF=2026-08-03   # misconfig start date
#   REMOTE_DB_HOST=172.28.92.60
#   REMOTE_DB_PORT=5442
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

APPLY=false
SKIP_BACKUP=false
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --skip-backup) SKIP_BACKUP=true ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

echo "========================================"
echo " KLIP BE fork → remote DB migration"
echo " Cutoff: ${BE_FORK_CUTOFF:-2026-08-03}"
if [[ "$APPLY" == "true" ]]; then
  echo " Mode:   APPLY"
else
  echo " Mode:   PREVIEW"
fi
echo "========================================"
echo ""

load_migration_env "$ROOT"
if [[ "$APPLY" == "true" ]]; then
  verify_backend_points_remote true
fi

echo ">>> Phase 0: verify & inventory"
bash "$ROOT/docs/scripts/compare-be-fork-vs-remote.sh"
echo ""

if [[ "$SKIP_BACKUP" != "true" ]]; then
  echo ">>> Phase 1A: backup local BE fork"
  bash "$ROOT/docs/scripts/dump-be-local-fork.sh"
  FULL=1 bash "$ROOT/docs/scripts/dump-be-local-fork.sh"
  echo ""
  echo ">>> Phase 1B: backup remote DB (run on DB server if this fails)"
  bash "$ROOT/docs/scripts/backup-pre-merge-remote.sh" 2>/dev/null || \
    echo "WARN: run on 172.28.92.60: bash docs/scripts/backup-pre-merge-remote.sh"
  echo ""
fi

echo ">>> Phase 3: load staging schema on remote"
if [[ "$APPLY" == "true" ]]; then
  bash "$ROOT/docs/scripts/load-be-fork-to-remote-staging.sh"
else
  DRY_RUN=1 bash "$ROOT/docs/scripts/load-be-fork-to-remote-staging.sh"
fi
echo ""

echo ">>> Phase 3b: merge preview/apply"
if [[ "$APPLY" == "true" ]]; then
  bash "$ROOT/docs/scripts/apply-be-fork-merge.sh" --apply
else
  bash "$ROOT/docs/scripts/apply-be-fork-merge.sh"
fi
echo ""

echo ">>> Phase 4: document uploads"
if [[ "$APPLY" == "true" ]]; then
  bash "$ROOT/docs/scripts/sync-be-fork-uploads.sh" --apply
else
  bash "$ROOT/docs/scripts/sync-be-fork-uploads.sh"
fi
echo ""

if [[ "$APPLY" == "true" ]]; then
  echo ">>> Phase 5: validate"
  bash "$ROOT/docs/scripts/validate-be-fork-merge.sh"
fi

echo ""
echo "Done. See docs/BE-DB-FORK-MIGRATION-RUNBOOK.md for rollback steps."
