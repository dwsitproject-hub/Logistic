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
   * COALESCE on every v5.0 column: a v4.x response omits them entirely, and `undefined ?? null`
   * would otherwise blank a milestone JPS had already told us about.
   */
  const sch = data.schedule ?? {};
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
         schedule_eta = COALESCE($12::timestamptz, schedule_eta),
         schedule_ta = COALESCE($13::timestamptz, schedule_ta),
         schedule_etb = COALESCE($14::timestamptz, schedule_etb),
         schedule_tb = COALESCE($15::timestamptz, schedule_tb),
         schedule_etc = COALESCE($16::timestamptz, schedule_etc),
         schedule_tc = COALESCE($17::timestamptz, schedule_tc),
         schedule_cast_off_at = COALESCE($18::timestamptz, schedule_cast_off_at),
         schedule_sailed_at = COALESCE($19::timestamptz, schedule_sailed_at),
         schedule_cargo_ops_start_at = COALESCE($20::timestamptz, schedule_cargo_ops_start_at),
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
