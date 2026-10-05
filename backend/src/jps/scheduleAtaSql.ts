import type { ShipmentAtaApiField } from '../utils/shipmentAtaOverrideFields';

/**
 * Which KLIP ATA field each JPS actual corresponds to - the ONE place this is decided.
 *
 * KLIP submits INBOUND instructions for BONTANG, so every JPS actual describes the DISCHARGE port. From the v5.4
 * `schedule`, with ATC chosen by the business:
 *
 *   ta                  Time of Arrival (operator arrival log)            -> ATA at DP        (partner ATA)
 *   tb                  Time of Berthing, actual (berthing log)           -> ATB              (partner ATB)
 *   cargo_ops_start_at  Cargo Operations, Entry 1 start        (v5.4)    -> ATS Discharge    (partner ATS)
 *   tc                  Operations completed (sign-off approval)          -> ATC Discharge
 *
 * Two readings of this file changed with the move from v5.0 to v5.4:
 *   - Start Discharging used to be unmapped ("JPS has no such event"); v5.4 added `cargo_ops_start_at`.
 *   - ATC Discharge stays on `tc`, as it was. JPS's own alias table names `cast_off_at` as its "ATC", but KLIP's ATC
 *     Discharge is the end of discharging, which is the sign-off, so the business keeps `tc`. `cast_off_at` and
 *     `sailed_at` (the departure) are still stored in jps_shipping_instructions.schedule_* and feed nothing here.
 *
 * Still NOT mapped: the estimates (eta, etb, etc) - this is the ACTUALS lane.
 *
 * `overrideColumn` is where the value is kept for the readers (shipment_ata_overrides.jps_ata_discharge_*, see
 * applyActuals.ts and sqlJpsAtaWhileOpen); `column` is JPS's own timestamp, which the modal's JPS reference reads.
 */
export const JPS_SCHEDULE_ATA_FIELDS: ReadonlyArray<{
  /** Key of the `schedule` object in the JPS response. */
  scheduleKey: 'ta' | 'tb' | 'cargo_ops_start_at' | 'tc';
  /** jps_shipping_instructions column holding JPS's timestamp. */
  column: string;
  ataField: ShipmentAtaApiField;
  /** shipment_ata_overrides column holding the WIB date the readers take first. */
  overrideColumn:
    | 'jps_ata_discharge_arrival'
    | 'jps_ata_discharge_berthed'
    | 'jps_ata_discharge_start'
    | 'jps_ata_discharge_complete';
  /** KLIP's name for it, for logs and messages. */
  klip: string;
}> = [
  { scheduleKey: 'ta', column: 'schedule_ta', ataField: 'ata_vessel_arrive_at_discharge_port', overrideColumn: 'jps_ata_discharge_arrival', klip: 'ATA at DP' },
  { scheduleKey: 'tb', column: 'schedule_tb', ataField: 'ata_vessel_berthed_at_discharge_port', overrideColumn: 'jps_ata_discharge_berthed', klip: 'ATB' },
  { scheduleKey: 'cargo_ops_start_at', column: 'schedule_cargo_ops_start_at', ataField: 'ata_vessel_start_discharging', overrideColumn: 'jps_ata_discharge_start', klip: 'ATS Discharge' },
  { scheduleKey: 'tc', column: 'schedule_tc', ataField: 'ata_vessel_complete_discharge', overrideColumn: 'jps_ata_discharge_complete', klip: 'ATC Discharge' },
];

/**
 * The JPS actuals as `{ <ATA api field>: 'YYYY-MM-DD' | null }`, dated in WIB.
 *
 * JPS sends UTC timestamps and KLIP's ATA fields are calendar dates. Cutting the date off the UTC
 * string would put anything that happens between 00:00 and 07:00 WIB on the PREVIOUS day - a
 * vessel berthing at 05:30 on the 2nd would read as the 1st. The conversion to Asia/Jakarta has to
 * happen before the date is taken, and in SQL, where the timestamp still carries its zone.
 */
export function sqlJpsAtaJsonExpr(alias: string): string {
  const pairs = JPS_SCHEDULE_ATA_FIELDS.map(
    ({ column, ataField }) =>
      `'${ataField}', ((${alias}.${column} AT TIME ZONE 'Asia/Jakarta')::date)::text`,
  );
  return `jsonb_build_object(${pairs.join(', ')})`;
}
