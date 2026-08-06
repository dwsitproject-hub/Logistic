#!/usr/bin/env bash
# Manually run the Contract ETA / Missing Planning reminder email on SIT backend.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/run-contract-eta-reminder-staging.sh
#   bash docs/scripts/run-contract-eta-reminder-staging.sh --to ryan.pohan@energi-up.com --recipients-only
#
# Notes:
# - Email is sent only when open contracts match (cargo readiness <= 14 days, missing ETA).
# - Without --recipients-only, DB Logistics recipients + CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS are included.
# - Requires SMTP_* configured in /opt/klip/.env and backend container rebuilt after git pull.
set -euo pipefail

TO=""
RECIPIENTS_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      if [[ -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "ERROR: --to requires an email address" >&2
        exit 1
      fi
      TO="$2"
      shift 2
      ;;
    --recipients-only) RECIPIENTS_ONLY=true; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --to EMAIL [--recipients-only])" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.backend.yml)

echo "==> Contract ETA reminder manual run (SIT)"
echo "    to=${TO:-<default recipients>}"
echo "    recipientsOnly=$RECIPIENTS_ONLY"
echo

NODE_ARGS=()
if [[ -n "$TO" ]]; then
  NODE_ARGS+=("--to=$TO")
fi
if [[ "$RECIPIENTS_ONLY" == true ]]; then
  NODE_ARGS+=("--recipients-only")
fi

if "${COMPOSE[@]}" exec -T backend test -f dist/scripts/runContractEtaReminderJob.js; then
  echo "==> Using dist/scripts/runContractEtaReminderJob.js"
  "${COMPOSE[@]}" exec -T backend node dist/scripts/runContractEtaReminderJob.js "${NODE_ARGS[@]}"
  exit $?
fi

echo "==> Script not in image yet — using inline service call (legacy fallback)"
echo "    Tip: git pull origin SIT && docker compose -f docker-compose.backend.yml up -d --build backend"
echo

LEGACY_NODE="
const svc = require('./dist/services/contractEtaReminder.service');
const run = svc.runContractEtaReminderJob;
if (typeof run !== 'function') {
  console.error('runContractEtaReminderJob not found — rebuild backend after git pull');
  process.exit(1);
}
const to = process.env.KLIP_ETA_REMINDER_TO || '';
const recipientsOnly = process.env.KLIP_ETA_REMINDER_RECIPIENTS_ONLY === 'true';
const opts = to
  ? { overrideRecipients: to.split(/[,;]/).map(s => s.trim()).filter(Boolean), recipientsOnly: recipientsOnly && !!to }
  : {};
run(opts).then((result) => {
  console.log(JSON.stringify(result || { sent: true, note: 'legacy void return' }, null, 2));
  process.exit(result && result.sent === false ? 1 : 0);
}).catch((err) => { console.error(err); process.exit(1); });
"

ENV_ARGS=()
if [[ -n "$TO" ]]; then
  ENV_ARGS+=(-e "KLIP_ETA_REMINDER_TO=$TO")
fi
if [[ "$RECIPIENTS_ONLY" == true ]]; then
  ENV_ARGS+=(-e "KLIP_ETA_REMINDER_RECIPIENTS_ONLY=true")
fi

"${COMPOSE[@]}" exec -T "${ENV_ARGS[@]}" backend node -e "$LEGACY_NODE"
