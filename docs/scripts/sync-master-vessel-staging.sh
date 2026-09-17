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
# shellcheck source=docs/scripts/lib/refresh-pipeline-summary-staging.sh
source "$ROOT/docs/scripts/lib/refresh-pipeline-summary-staging.sh"

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
echo "==> Applying import (null shipment FKs, delete master vessels, reload SQL, relink)"
echo "    WARNING: never TRUNCATE master_vessels CASCADE — shipments FK would wipe all shipments."

# pg_dump may emit psql meta-commands (\\restrict) and PowerShell may add UTF-8 BOM — strip before load.
SANITIZED="$(
  sed -e '1s/^\xEF\xBB\xBF//' -e '/^\\restrict/d' -e '/^\\unrestrict/d' "$FILE"
)"

echo "$SANITIZED" | "${COMPOSE[@]}" exec -T backend node -e "
const fs = require('fs');
const { Pool } = require('pg');
const raw = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
const inserts = raw.split('\n').map((l) => l.trim()).filter((l) => /^INSERT INTO public\\.(master_vessels|master_vessel_code_aliases)\\b/i.test(l));
if (inserts.length === 0) {
  console.error('ERROR: no INSERT statements found in SQL file (after sanitizing pg_dump meta-commands)');
  process.exit(1);
}
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
  // DELETE only — TRUNCATE master_vessels CASCADE would cascade-truncate shipments (FK master_vessel_id).
  await p.query('DELETE FROM master_vessels');
  for (const stmt of inserts) {
    await p.query(stmt);
  }
  await p.query(\`
    UPDATE shipments s
    SET master_vessel_id = sub.master_vessel_id,
        updated_at = CURRENT_TIMESTAMP
    FROM (
      SELECT s2.id AS shipment_id,
             COALESCE(
               mv_alias.id,
               mv_primary.id,
               mv_name.id
             ) AS master_vessel_id
      FROM shipments s2
      LEFT JOIN master_vessel_code_aliases a
        ON NULLIF(TRIM(COALESCE(s2.vessel_code, '')), '') IS NOT NULL
       AND upper(trim(a.vessel_code)) = upper(trim(s2.vessel_code))
      LEFT JOIN master_vessels mv_alias ON mv_alias.id = a.master_vessel_id
      LEFT JOIN master_vessels mv_primary
        ON NULLIF(TRIM(COALESCE(s2.vessel_code, '')), '') IS NOT NULL
       AND upper(trim(mv_primary.vessel_code)) = upper(trim(s2.vessel_code))
      LEFT JOIN LATERAL (
        SELECT mv.id
        FROM master_vessels mv
        WHERE NULLIF(TRIM(COALESCE(s2.vessel_name, '')), '') IS NOT NULL
          AND mv.normalized_vessel_name = upper(
            regexp_replace(
              regexp_replace(trim(s2.vessel_name), '^BG\\\\.\\\\s*', '', 'i'),
              '^MT\\\\.\\\\s*', '', 'i'
            )
          )
        ORDER BY CASE WHEN mv.code_status = 'OFFICIAL' THEN 0 ELSE 1 END, mv.updated_at DESC
        LIMIT 1
      ) mv_name ON true
      WHERE COALESCE(mv_alias.id, mv_primary.id, mv_name.id) IS NOT NULL
    ) sub
    WHERE s.id = sub.shipment_id
      AND (s.master_vessel_id IS NULL OR s.master_vessel_id <> sub.master_vessel_id)
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
refresh_pipeline_summary_staging || true
print_shipment_pipeline_summary_counts_staging

echo ""
echo "SUCCESS. Verify /master-vessel and /shipments Section 1 (Ctrl+Shift+R)."
