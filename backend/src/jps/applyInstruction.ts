/**
 * Write what JPS reports about an instruction onto its row. Used by the poller and by the webhook receiver, so the two
 * cannot drift: a status that arrives either way lands in the same columns.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { applyJpsAtaLane } from './applyActuals';
import type { JpsInstruction } from './types';

export async function applyJpsInstruction(rowId: string, data: JpsInstruction): Promise<void> {
  /*
   * COALESCE on the columns that are not times of the schedule: a v4.x response omits them entirely, and `undefined ?? null`
   * would otherwise blank a milestone JPS had already told us about.
   *
   * The schedule times are different. JPS recalculates them from current data and says so when one is taken back: Closing cleared sends
   * schedule.updated with cargo_ops_end_at null, an Opening row deleted moves cargo_ops_start_at, a stage can move back (JPS answer, 2026-11-16). A time
   * the response CARRIES as null is therefore "not logged" and clears the column, exactly as the JPS lane already does (planJpsAtaLane). Only a key the
   * response does not carry at all (a v4.x or v5.3 response has no schedule, or no cargo_ops_*) leaves the column alone, which is what the list of
   * present keys ($22) decides.
   */
  const sch = data.schedule ?? {};
  const scheduleKeys = Object.keys(sch).filter((key) => (sch as Record<string, unknown>)[key] !== undefined);
  const updated = await query(
    `UPDATE jps_shipping_instructions
     SET jps_id = COALESCE($2, jps_id),
         jps_status = $3,
         rejection_reason = COALESCE($4, rejection_reason),
         jetty_name = COALESCE($5, jetty_name),
         planned_berthing_time = COALESCE($6::timestamptz, planned_berthing_time),
         plan_reference = COALESCE($7, plan_reference),
         jetty_code = COALESCE($8, jetty_code),
         etr_minutes = COALESCE($9::int, etr_minutes),
         approved_at = COALESCE($10::timestamptz, approved_at),
         rejected_at = COALESCE($11::timestamptz, rejected_at),
         schedule_eta = CASE WHEN 'eta' = ANY($22::text[]) THEN $12::timestamptz ELSE schedule_eta END,
         schedule_ta = CASE WHEN 'ta' = ANY($22::text[]) THEN $13::timestamptz ELSE schedule_ta END,
         schedule_etb = CASE WHEN 'etb' = ANY($22::text[]) THEN $14::timestamptz ELSE schedule_etb END,
         schedule_tb = CASE WHEN 'tb' = ANY($22::text[]) THEN $15::timestamptz ELSE schedule_tb END,
         schedule_etc = CASE WHEN 'etc' = ANY($22::text[]) THEN $16::timestamptz ELSE schedule_etc END,
         schedule_tc = CASE WHEN 'tc' = ANY($22::text[]) THEN $17::timestamptz ELSE schedule_tc END,
         schedule_cast_off_at = CASE WHEN 'cast_off_at' = ANY($22::text[]) THEN $18::timestamptz ELSE schedule_cast_off_at END,
         schedule_sailed_at = CASE WHEN 'sailed_at' = ANY($22::text[]) THEN $19::timestamptz ELSE schedule_sailed_at END,
         schedule_cargo_ops_start_at = CASE WHEN 'cargo_ops_start_at' = ANY($22::text[]) THEN $20::timestamptz ELSE schedule_cargo_ops_start_at END,
         schedule_cargo_ops_end_at = CASE WHEN 'cargo_ops_end_at' = ANY($22::text[]) THEN $21::timestamptz ELSE schedule_cargo_ops_end_at END,
         last_polled_at = NOW(),
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING sto_key`,
    [
      rowId,
      data.id ?? null,
      data.status ?? null,
      data.rejection_reason ?? data.approval?.rejection_reason ?? null,
      data.allocation?.jetty_name ?? null,
      data.allocation?.planned_berthing_time ?? null,
      data.plan_reference ?? null,
      data.allocation?.jetty_code ?? null,
      data.etr_minutes ?? null,
      data.approval?.approved_at ?? null,
      data.approval?.rejected_at ?? null,
      sch.eta ?? null,
      sch.ta ?? null,
      sch.etb ?? null,
      sch.tb ?? null,
      sch.etc ?? null,
      sch.tc ?? null,
      sch.cast_off_at ?? null,
      sch.sailed_at ?? null,
      sch.cargo_ops_start_at ?? null,
      sch.cargo_ops_end_at ?? null,
      scheduleKeys,
    ],
  );

  /*
   * The same response also carries the actual times, which KLIP keeps as the JPS lane of the discharge ATA (SAP, KLIP,
   * JPS). The status above is already saved, so a failure here is logged and left for the next poll or webhook to make
   * again - it compares with what the lane holds - instead of failing the status update.
   */
  const stoKey = (updated.rows[0] as { sto_key?: string } | undefined)?.sto_key;
  if (stoKey && data.schedule) {
    try {
      await applyJpsAtaLane(stoKey, data.schedule);
    } catch (error) {
      logger.warn('JPS actual times not applied to shipments; retried on the next poll or webhook', {
        stoKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
