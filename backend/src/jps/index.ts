/**
 * Jetty Planning System integration — outbound only.
 *
 * KLIP submits a Shipping Instruction per STO for vessels discharging at BONTANG, then polls for
 * the operator's decision. JPS has no webhook in v1 and no way to cancel an instruction, so the
 * whole conversation is: submit once, poll until it settles.
 */
export { isJpsEnabled, jpsRegionSite, jpsRetryFailed, jpsSweepCron } from './config';
export { submitEligibleStos, type JpsSubmitSummary } from './submit';
export { handleJpsWebhook, type JpsWebhookResult } from './webhookHandler';
export { pollSubmittedInstructions, type JpsPollSummary } from './poll';
export { amendPendingInstructions, buildJpsAmendBody, type JpsAmendSummary } from './amend';
export { findEligibleStos, type EligibleSto } from './eligibility';
export {
  buildJpsSubmitPayload,
  buildJpsExternalReference,
  mapKlipIncotermToJpsTradeTerm,
  toJpsDateTime,
} from './mapper';
export type { JpsInstruction, JpsPartnerStatus, JpsSubmitPayload } from './types';

import logger from '../utils/logger';
import { amendPendingInstructions } from './amend';
import { isJpsEnabled } from './config';
import { pollSubmittedInstructions } from './poll';
import { submitEligibleStos } from './submit';

/**
 * Jetty Status is a column of the Shipments list, and the list keeps its pages (and the summary cards) in memory for
 * an hour. A status JPS changed - or an instruction KLIP has just sent - is written straight to
 * jps_shipping_instructions, which no user edit passes through, so nothing cleared those pages: JPS approved an
 * instruction and the list went on saying Pending (or Not Sent) until the cache expired. Clear them when something
 * visible changed, and only then: the clear makes the next list load, and the warm-up behind it, do real work.
 */
async function refreshShipmentsListIfJettyChanged(sent: number, statusChanges: number): Promise<void> {
  if (sent <= 0 && statusChanges <= 0) return;
  try {
    const { invalidateShipmentsListCache } = await import('../services/shipmentList.service');
    invalidateShipmentsListCache();
  } catch (error) {
    logger.warn('JPS: could not clear the Shipments list cache', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * One full pass: send what is newly eligible, then collect decisions. Called on a schedule, and
 * again right after a SAP import or a shipment edit so a user who has just filled in ATC Loading
 * or the discharge ETA sees the jetty status without waiting for the next tick.
 */
export async function runJpsSync(reason: string): Promise<void> {
  if (!isJpsEnabled()) return;
  try {
    const submitted = await submitEligibleStos();
    // Amend before polling: an instruction the operator decides on mid-sweep comes back
    // INVALID_STATE, and the poll that follows records the decision either way.
    const amended = await amendPendingInstructions();
    const polled = await pollSubmittedInstructions();
    await refreshShipmentsListIfJettyChanged(submitted.submitted + submitted.recovered, polled.changed);
    if (submitted.considered > 0 || amended.amended > 0 || polled.changed > 0 || polled.errors > 0) {
      logger.info('JPS sync', { reason, ...submitted, amended: amended.amended, ...polled });
    }
  } catch (error) {
    // Never let the jetty integration take down the caller - a SAP import must finish even if JPS
    // is unreachable.
    logger.warn('JPS sync failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
