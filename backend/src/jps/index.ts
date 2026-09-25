/**
 * Jetty Planning System integration — outbound only.
 *
 * KLIP submits a Shipping Instruction per STO for vessels discharging at BONTANG, then polls for
 * the operator's decision. JPS has no webhook in v1 and no way to cancel an instruction, so the
 * whole conversation is: submit once, poll until it settles.
 */
export { isJpsEnabled, jpsRegionSite, jpsRetryFailed, jpsSweepCron } from './config';
export { submitEligibleStos, type JpsSubmitSummary } from './submit';
export { pollSubmittedInstructions, type JpsPollSummary } from './poll';
export { amendPendingInstructions, buildJpsAmendBody, type JpsAmendSummary } from './amend';
export { findEligibleStos, type EligibleSto } from './eligibility';
export {
  buildJpsSubmitPayload,
  buildJpsExternalReference,
  mapKlipProductToJpsCargoType,
  mapKlipIncotermToJpsTradeTerm,
  toJpsDateTime,
  JPS_CARGO_TYPES,
} from './mapper';
export type { JpsInstruction, JpsPartnerStatus, JpsSubmitPayload } from './types';

import logger from '../utils/logger';
import { amendPendingInstructions } from './amend';
import { isJpsEnabled } from './config';
import { pollSubmittedInstructions } from './poll';
import { submitEligibleStos } from './submit';

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
