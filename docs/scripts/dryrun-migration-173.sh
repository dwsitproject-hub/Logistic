#!/usr/bin/env bash
#
# DRY RUN: apply migration 173 inside a transaction, report exactly what it would clear, ROLL BACK.
#
# 173 deletes ATA dates whose evidence of being copies is circumstantial - two vessels cannot finish
# at the same moment - not conclusive. The rule is also symmetric: it sees the pair, not which half
# is the copy, so the genuine voyage is only protected by "this STO has no such value in SAP". On
# the dev copy it selected rows on the STO that is the SOURCE of the contamination in production.
#
# So: read the list this prints before applying anything. Nothing is written by this script.
#
#   bash /opt/klip/docs/scripts/dryrun-migration-173.sh
#
set -u
cd /opt/klip || exit 1
MIG="backend/src/database/migrations/173_clear_vlp_ata_copied_across_contracts.sql"
[ -f "$MIG" ] || { echo "migration not found: $MIG (git pull first)"; exit 1; }

env_val() { sed -n "s/^$1=//p" .env | head -1 | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
export PGPASSWORD="$(env_val DB_PASSWORD)"

{
  echo "BEGIN;"
  cat "$MIG"
  echo ";"
  echo "\echo '== rows this migration WOULD clear =='"
  echo "SELECT own_sto, vessel_name, old_value::date AS cleared_value, COUNT(*) AS rows
        FROM vlp_ata_bleed_backup_173 GROUP BY 1,2,3 ORDER BY 4 DESC, 1;"
  echo "\echo '== and the shipment status behind each, which decides whether it is plausible =='"
  echo "SELECT b.own_sto, b.vessel_name, s.status, COUNT(*) AS rows
        FROM vlp_ata_bleed_backup_173 b
        JOIN vessel_loading_ports v ON v.id = b.vlp_id
        JOIN shipments s ON s.id = v.shipment_id
        GROUP BY 1,2,3 ORDER BY 1;"
  echo "ROLLBACK;"
} | psql -P pager=off -v ON_ERROR_STOP=1 \
      -h "$(env_val DB_HOST)" -p "$(env_val DB_PORT)" \
      -U "$(env_val DB_USER)" -d "$(env_val DB_NAME)"

echo
echo "Rolled back - the database is unchanged."
echo "A row whose shipment is PLANNED cannot have finished discharging: that one is safe to clear."
echo "A row whose shipment is COMPLETED or SAILED may hold a real date - check those before applying."
