/**
 * Put the actual times JPS already reported onto the shipments, once.
 *
 * The poll only reads instructions that can still move, and a webhook only fires on a change, so an instruction that
 * reached Sailed before the JPS lane existed would never be written. This reads what jps_shipping_instructions already
 * holds (schedule_ta / tb / cargo_ops_start_at / tc) and applies it with the same function the poll and the
 * webhook use. `schedule_cargo_ops_start_at` is empty for instructions older than API v5.4; those get ATS on their next
 * response, if JPS still sends one.
 *
 * Dry run unless --apply:
 *   node dist/scripts/backfillJpsAtaLane.js            (prints what would change)
 *   node dist/scripts/backfillJpsAtaLane.js --apply
 */
import pool, { query } from '../database/connection';
import { applyJpsAtaLane } from '../jps/applyActuals';
import { JPS_SCHEDULE_ATA_FIELDS } from '../jps/scheduleAtaSql';
import type { JpsSchedule } from '../jps/types';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const columns = JPS_SCHEDULE_ATA_FIELDS.map(
    (f) => `to_char(${f.column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${f.column}`,
  ).join(', ');
  const anyActual = JPS_SCHEDULE_ATA_FIELDS.map((f) => `${f.column} IS NOT NULL`).join(' OR ');

  const rows = await query(
    `SELECT sto_key, jps_status, ${columns}
     FROM jps_shipping_instructions
     WHERE state = 'SUBMITTED' AND (${anyActual})
     ORDER BY sto_key`,
  );

  let touched = 0;
  for (const row of rows.rows as Array<Record<string, string | null>>) {
    // Only what JPS actually reported: an empty column here means "unknown", never "JPS took it back".
    const schedule: JpsSchedule = {};
    for (const f of JPS_SCHEDULE_ATA_FIELDS) {
      const value = row[f.column];
      if (value) (schedule as Record<string, string>)[f.scheduleKey] = value;
    }
    const result = await applyJpsAtaLane(String(row.sto_key), schedule, { dryRun: !apply });
    if (result.changedShipmentIds.length > 0) touched += result.changedShipmentIds.length;
    console.log(
      `${apply ? 'applied' : 'would apply'}  STO ${row.sto_key}  [${row.jps_status}]  shipments: ${result.changedShipmentIds.length}/${result.shipmentIds.length}`,
    );
  }
  console.log(`${apply ? 'Applied to' : 'Would apply to'} ${touched} shipment(s) from ${rows.rows.length} instruction(s).`);
  if (!apply) console.log('Dry run. Re-run with --apply to write.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
