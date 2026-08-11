#!/usr/bin/env bash
# Replace SIT master_vessels + master_vessel_code_aliases with a local export file.
#
# Prereq: migrations 135/136 applied (node dist/database/migrate.js)
#
# Usage on SIT backend (172.28.92.57), from /opt/klip:
#   bash docs/scripts/sync-master-vessel-staging.sh --file tmp/master_vessel_local_to_sit.sql
#   bash docs/scripts/sync-master-vessel-staging.sh --file tmp/master_vessel_local_to_sit.sql --apply
#
# Export on dev laptop first:
#   powershell -File docs/scripts/export-master-vessel-local.ps1
#   scp tmp/master_vessel_local_to_sit.sql ubuntu@172.28.92.57:/opt/klip/tmp/
set -euo pipefail

APPLY=false
FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --file)
      FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.backend.yml)

if [[ -z "$FILE" ]]; then
  echo "ERROR: --file <path-to-sql> required" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "ERROR: file not found: $FILE" >&2
  exit 1
fi

echo "=== KLIP master vessel sync (local → SIT) ==="
echo "    file: $FILE"
echo "    mode: $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"

echo ""
echo "==> Health"
curl -sf http://127.0.0.1:5001/health >/dev/null || {
  echo "ERROR: backend /health failed" >&2
  exit 1
}

echo ""
echo "==> Run migrations (135/136 master vessel schema)"
"${COMPOSE[@]}" exec -T backend node dist/database/migrate.js

echo ""
echo "==> Current SIT counts"
"${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  const mv = await p.query('SELECT COUNT(*)::int AS n FROM master_vessels');
  const al = await p.query('SELECT COUNT(*)::int AS n FROM master_vessel_code_aliases');
  console.log('master_vessels:', mv.rows[0]?.n);
  console.log('master_vessel_code_aliases:', al.rows[0]?.n);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"

if ! $APPLY; then
  echo ""
  echo "Preview only. To replace SIT master vessel data with export file:"
  echo "  bash docs/scripts/sync-master-vessel-staging.sh --file $FILE --apply"
  exit 0
fi

echo ""
echo "==> Applying import (null shipment FKs, truncate, reload SQL, relink by vessel_code)"

cat "$FILE" | "${COMPOSE[@]}" exec -T backend node -e "
const fs = require('fs');
const { Pool } = require('pg');
const sql = fs.readFileSync(0, 'utf8');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  await p.query('BEGIN');
  await p.query('UPDATE shipments SET master_vessel_id = NULL WHERE master_vessel_id IS NOT NULL');
  await p.query('TRUNCATE master_vessel_code_aliases');
  await p.query('TRUNCATE master_vessels CASCADE');
  await p.query(sql);
  await p.query(\`
    UPDATE shipments s
    SET master_vessel_id = mv.id,
        updated_at = CURRENT_TIMESTAMP
    FROM master_vessels mv
    WHERE s.master_vessel_id IS NULL
      AND NULLIF(TRIM(COALESCE(s.vessel_code, '')), '') IS NOT NULL
      AND upper(trim(s.vessel_code)) = upper(trim(mv.vessel_code))
  \`);
  const mv = await p.query('SELECT COUNT(*)::int AS n FROM master_vessels');
  const al = await p.query('SELECT COUNT(*)::int AS n FROM master_vessel_code_aliases');
  const linked = await p.query('SELECT COUNT(*)::int AS n FROM shipments WHERE master_vessel_id IS NOT NULL');
  await p.query('COMMIT');
  console.log(JSON.stringify({
    master_vessels: mv.rows[0]?.n,
    master_vessel_code_aliases: al.rows[0]?.n,
    shipments_linked: linked.rows[0]?.n,
  }, null, 2));
  await p.end();
})().catch(async (e) => {
  console.error(e);
  try { await p.query('ROLLBACK'); } catch (_) {}
  process.exit(1);
});
"

echo ""
echo "SUCCESS. Verify /master-vessel in browser (Ctrl+Shift+R)."
