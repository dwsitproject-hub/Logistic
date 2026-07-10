#!/usr/bin/env bash
# KLIP — Commit & push ke branch SIT (Git Bash / WSL)
# Usage: cd /d/Project/Klip && bash docs/scripts/push-to-sit.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="${BRANCH:-SIT}"
MESSAGE="${MESSAGE:-fix(contract-perf): SAP-strict cash/DP cycles, ETA today fallback, linked tree alignment}"

cd "${REPO_ROOT}"

if [[ ! -d .git ]]; then
  echo "ERROR: .git tidak ada di ${REPO_ROOT}"
  echo "Jalankan dari folder clone repo yang punya remote."
  exit 1
fi

git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

if [[ -n "$(git status --porcelain)" ]]; then
  git add \
    backend/src/services/latePerformance.service.ts \
    backend/src/services/latePerformance.deliveryEnd.test.ts \
    backend/src/controllers/contract.controller.ts \
    backend/src/controllers/contractsListOuterSql.ts \
    frontend/src/lib/contractPerformanceFilters.ts \
    frontend/src/lib/contractPerformanceFilters.test.ts \
    frontend/src/hooks/useContractPerformanceFilters.ts \
    frontend/src/app/contracts/page.tsx \
    frontend/src/lib/fieldHelpText.ts \
    docs/scripts/staging-deploy-putty.txt \
    docs/scripts/push-to-sit.ps1 \
    docs/scripts/push-to-sit.sh 2>/dev/null || true
  git add -u backend/src frontend/src docs/scripts
  git commit -m "${MESSAGE}"
fi

git push origin "${BRANCH}"
echo "Done. Deploy manual: docs/scripts/staging-deploy-putty.txt (STEP 2)"
