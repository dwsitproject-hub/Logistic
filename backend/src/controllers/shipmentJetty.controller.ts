import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { checkJpsReadiness } from '../jps/readiness';
import { refreshInstructionFromJps } from '../jps/poll';
import { submitShipmentToJps } from '../jps/manualSubmit';
import logger from '../utils/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shipmentIdOf(req: AuthRequest, res: Response): string | null {
  const id = String(req.params.id ?? '').trim();
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: { message: 'Invalid shipment id' } });
    return null;
  }
  return id;
}

/** What the Submit to Jetty dialog opens with: each requirement, what KLIP found, and where to fix what is missing. Read-only. */
export const getShipmentJettyReadiness = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = shipmentIdOf(req, res);
  if (!id) return;
  try {
    res.json({ success: true, data: await checkJpsReadiness(id) });
  } catch (error) {
    logger.error('Jetty readiness check failed', { shipmentId: id, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ success: false, error: { message: 'Could not check Jetty readiness' } });
  }
};

/**
 * Send this shipment's STO to JPS and return JPS's answer. A request is made only when the readiness check passes; otherwise the same readiness is returned
 * with attempted=false, so the dialog can show what is still missing instead of an error.
 */
export const submitShipmentToJetty = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = shipmentIdOf(req, res);
  if (!id) return;
  try {
    const result = await submitShipmentToJps(id);
    res.json({ success: true, data: { id, ...result } });
  } catch (error) {
    logger.error('Submit to Jetty failed', { shipmentId: id, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ success: false, error: { message: 'Could not submit to Jetty' } });
  }
};

/**
 * Ask JPS now what it holds for this shipment's STO and store the answer (the dialog's Refresh from JPS). Returns the new readiness with it, so a
 * rejection that JPS made shows its reason and the resubmit option straight away.
 */
export const refreshShipmentJetty = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = shipmentIdOf(req, res);
  if (!id) return;
  try {
    const before = await checkJpsReadiness(id);
    const refresh = before.stoKey ? await refreshInstructionFromJps(before.stoKey) : ({ kind: 'none' } as const);
    // Read again: what JPS just said changes the tracker, and with it what can be done next.
    const readiness = refresh.kind === 'refreshed' && refresh.changed ? await checkJpsReadiness(id) : before;
    if (refresh.kind === 'refreshed' && refresh.changed) {
      try {
        const { invalidateShipmentsListCache } = await import('../services/shipmentList.service');
        invalidateShipmentsListCache();
      } catch (error) {
        logger.warn('JPS: could not clear the Shipments list cache', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    res.json({ success: true, data: { id, refresh, readiness } });
  } catch (error) {
    logger.error('Refresh from JPS failed', { shipmentId: id, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ success: false, error: { message: 'Could not refresh from JPS' } });
  }
};
