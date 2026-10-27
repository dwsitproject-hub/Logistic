import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { checkJpsReadiness } from '../jps/readiness';
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
