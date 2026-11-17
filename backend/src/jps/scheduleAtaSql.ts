import type { ShipmentAtaApiField } from '../utils/shipmentAtaOverrideFields';

/**
 * Which KLIP ATA field each JPS actual corresponds to - the ONE place this is decided.
 *
 * KLIP submits INBOUND instructions for BONTANG, so every JPS actual describes the DISCHARGE port. From the v5.4
 * `schedule` (v5.5 for ATS and ATC, JPS's own table for KLIP Hose On / Hose Off):
 *
 *   ta                  Time of Arrival (operator arrival log)             -> ATA at DP        (partner ATA)
 *   tb                  Time of Berthing, actual (berthing log)            -> ATB              (partner ATB)
 *   cargo_ops_start_at  Hose On: the earliest OPENING start                -> ATS Discharge    (partner ATS)
 *   cargo_ops_end_at    Hose Off: the CLOSING time                         -> ATC Discharge    (partner ATC)
 *
 * JPS's own words (2026-11-16, API still 5.7; the v5.5-5.7 guide still says "operation window", which was the PREVIOUS source of both): Hose On is Opening and
 * Hose Off is Closing. Closing is a time an operator records in Post-Checking. It is NOT filled when cargo operations end, when the status becomes Cargo Done or
 * when the vessel sails, and it is often recorded after Cargo Done - so null on a Cargo Done or Sailed Off instruction is expected, and ATC stays
 * cargo_ops_end_at: JPS says not to substitute cargo_done_at or tc. There is no ordering guarantee between start, end and cargo_done_at. Values are
 * recalculated from current data on every GET (Opening can still change after the vessel finished; clearing Closing sends schedule.updated with
 * cargo_ops_end_at null), so a time KLIP stored from an earlier poll can differ from GET today: the lane and the stored copy are rewritten from what JPS
 * sends, null included, and a sailed vessel is still polled for a while (poll.ts).
 *
 * What moved since v5.0:
 *   - Start Discharging used to be unmapped ("JPS has no such event"); v5.4 added `cargo_ops_start_at`, and v5.5 made it
 *     the window start (v5.4: Entry 1 start).
 *   - ATC Discharge was `tc` (operations signed off) until v5.5 added `cargo_ops_end_at`; JPS tells KLIP integrators to
 *     use that. `tc`, `cast_off_at` and `sailed_at` (the departure, not Hose Off) are still stored in
 *     jps_shipping_instructions.schedule_* and feed nothing here.
 *
 * Still NOT mapped: the estimates (eta, etb, etc) - this is the ACTUALS lane.
 *
 * `overrideColumn` is where the value is kept for the readers (shipment_ata_overrides.jps_ata_discharge_*, see
 * applyActuals.ts and sqlJpsAtaWhileOpen); `column` is JPS's own timestamp, which the modal's JPS reference reads.
 */
export const JPS_SCHEDULE_ATA_FIELDS: ReadonlyArray<{
  /** Key of the `schedule` object in the JPS response. */
  scheduleKey: 'ta' | 'tb' | 'cargo_ops_start_at' | 'cargo_ops_end_at';
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
  { scheduleKey: 'cargo_ops_end_at', column: 'schedule_cargo_ops_end_at', ataField: 'ata_vessel_complete_discharge', overrideColumn: 'jps_ata_discharge_complete', klip: 'ATC Discharge' },
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

/**
 * JPS's ESTIMATES for the discharge port, as `{ <KLIP estimation field>: 'YYYY-MM-DD' | null }`, dated in WIB like the actuals above.
 *
 *   eta  Estimated time of arrival      -> eta_vessel_arrive_at_discharge_port   (ETA at Discharge Port)
 *   etb  Estimated time of berthing     -> eta_vessel_berthed_at_discharge_port  (ETB at Discharge Port)
 *   etc  Estimated time of completion   -> eta_vessel_complete_discharge         (ETC at Discharge Port)
 *
 * They are what the JPS operators plan, and they move after KLIP sent its own ETA, so the Edit / View Shipment modal draws them as the main value with
 * the JPS badge and keeps KLIP's own estimate small underneath. Display only: nothing here is written to the shipment, and no list reads it.
 * `alias` is a jps_shipping_instructions row (schedule_eta / schedule_etb / schedule_etc, migration 188).
 */
export function sqlJpsEstimateJsonExpr(alias: string): string {
  return `jsonb_build_object(
    'eta_vessel_arrive_at_discharge_port', ((${alias}.schedule_eta AT TIME ZONE 'Asia/Jakarta')::date)::text,
    'eta_vessel_berthed_at_discharge_port', ((${alias}.schedule_etb AT TIME ZONE 'Asia/Jakarta')::date)::text,
    'eta_vessel_complete_discharge', ((${alias}.schedule_etc AT TIME ZONE 'Asia/Jakarta')::date)::text
  )`;
}
