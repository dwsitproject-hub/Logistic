import type { ShipmentAtaApiField } from '../utils/shipmentAtaOverrideFields';

/**
 * Which KLIP ATA field each JPS actual corresponds to.
 *
 * KLIP submits INBOUND instructions for BONTANG, so every JPS actual describes the DISCHARGE port.
 * From the v5.0 schedule table:
 *
 *   ta  Time of Arrival (operator arrival log)       -> ATA at Discharge Port
 *   tb  Time of Berthing, actual (berthing log)       -> ATB at Discharge Port
 *   tc  Operations completed (sign-off approval)      -> ATC Discharge
 *
 * Deliberately NOT mapped:
 *   - Start Discharging: JPS has no such event, so that field stays SAP / KLIP only.
 *   - cast_off_at / sailed_at: departure FROM Bontang. KLIP has no discharge-side sailed field, and
 *     "Sailed from Loading Port" is the other end of the voyage - mapping it there would be wrong.
 *   - the estimates (eta, etb, etc): this is the ACTUALS badge. An estimate is not an actual.
 */
export const JPS_SCHEDULE_ATA_FIELDS: ReadonlyArray<{ column: string; ataField: ShipmentAtaApiField }> = [
  { column: 'schedule_ta', ataField: 'ata_vessel_arrive_at_discharge_port' },
  { column: 'schedule_tb', ataField: 'ata_vessel_berthed_at_discharge_port' },
  { column: 'schedule_tc', ataField: 'ata_vessel_complete_discharge' },
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
