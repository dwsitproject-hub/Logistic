import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  approveVesselReview,
  countVesselsForReview,
  listVesselsForReview,
  mergeVesselForReview,
} from '../services/masterVesselReview.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /master-vessels/review - the vessels KLIP registered from SAP and is not sure of. */
export const listReviewVessels = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [items, total] = await Promise.all([listVesselsForReview(), countVesselsForReview()]);
    res.json({ success: true, data: { items, total } });
  } catch (error) {
    logger.error('List vessels for review error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch vessels for review' } });
  }
};

/** POST /master-vessels/:id/review/approve */
export const approveReviewVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id ?? '');
    if (!UUID_RE.test(id)) {
      res.status(400).json({ success: false, error: { message: 'Invalid vessel id' } });
      return;
    }
    const approved = await approveVesselReview(id);
    if (!approved) {
      res.status(409).json({ success: false, error: { message: 'Kapal ini tidak sedang menunggu review.' } });
      return;
    }
    res.json({ success: true, data: { id } });
  } catch (error) {
    logger.error('Approve vessel review error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to approve the vessel' } });
  }
};

/** POST /master-vessels/:id/review/merge  { intoId } - merge the vessel into the one it really is. */
export const mergeReviewVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fromId = String(req.params.id ?? '');
    const intoId = String((req.body as { intoId?: unknown })?.intoId ?? '');
    if (!UUID_RE.test(fromId) || !UUID_RE.test(intoId)) {
      res.status(400).json({ success: false, error: { message: 'Invalid vessel id' } });
      return;
    }
    const result = await mergeVesselForReview(fromId, intoId);
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: { message: result.error } });
      return;
    }
    res.json({ success: true, data: { into: result.into, moved: result.moved } });
  } catch (error) {
    logger.error('Merge vessel for review error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to merge the vessel' } });
  }
};
