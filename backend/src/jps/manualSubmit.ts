/**
 * Send ONE shipment's STO to JPS on a user's request (the Submit to Jetty button), and say exactly what JPS answered.
 *
 * It goes through the same code as the sweep (submitOneSto): the same revision rule (a FAILED row is retried under the same reference, so JPS never sees
 * two), the same duplicate recovery, the same tracker rows. The sweep and a button press racing on one STO therefore cannot create two instructions: they
 * pick the same external reference and JPS answers the second with 409, which is recovered.
 *
 * It sends only when KLIP's own readiness check passes (readiness.ts), so a press never produces a request KLIP already knows JPS must refuse.
 */
import logger from '../utils/logger';
import { fetchJpsPortCompanies } from './companies';
import { fetchJpsKnownPorts } from './portCatalog';
import { jpsEnabledPortNames } from './config';
import { findEligibleStos } from './eligibility';
import { checkJpsReadiness, type JpsReadiness } from './readiness';
import { submitOneSto, type SubmitOutcome } from './submit';

export interface ManualSubmitResult {
  /** True only when a request was made to JPS. False means KLIP held it back: see readiness. */
  attempted: boolean;
  readiness: JpsReadiness;
  outcome: SubmitOutcome | null;
}

export async function submitShipmentToJps(shipmentId: string): Promise<ManualSubmitResult> {
  const readiness = await checkJpsReadiness(shipmentId);
  if (!readiness.canSubmit || !readiness.stoKey) return { attempted: false, readiness, outcome: null };

  const [sto] = await findEligibleStos(jpsEnabledPortNames(), 1, { stoKeys: [readiness.stoKey] });
  // The readiness check just loaded this same STO, so this only happens if its data changed in between.
  if (!sto) return { attempted: false, readiness: { ...readiness, canSubmit: false, reason: 'The shipment data changed while checking. Try again.' }, outcome: null };

  const portCatalog = await fetchJpsPortCompanies();
  const outcome = await submitOneSto(sto, portCatalog, await fetchJpsKnownPorts());
  logger.info('JPS: Submit to Jetty', { stoKey: readiness.stoKey, shipmentId, outcome: outcome.kind });

  // The Shipments list keeps its pages for an hour; what was just sent (or refused) must show now, not later.
  if (outcome.kind !== 'retryable') {
    try {
      const { invalidateShipmentsListCache } = await import('../services/shipmentList.service');
      invalidateShipmentsListCache();
    } catch (error) {
      logger.warn('JPS: could not clear the Shipments list cache', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { attempted: true, readiness, outcome };
}
