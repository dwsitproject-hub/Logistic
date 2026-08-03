import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { isPrePlannedGroupingEnabled } from '../config/prePlannedConfig';
import {
  acceptPrePlannedGroupLink,
  dismissPrePlannedGroup,
  getPrePlannedGroupById,
  getPrePlannedMetrics,
  listPrePlannedGroups,
  rebuildPrePlannedGroups,
  revertPrePlannedGroupToSuggested,
} from '../services/prePlannedGroup.service';

function disabled(res: Response): void {
  res.status(503).json({
    success: false,
    error: { message: 'Pre-planned grouping is disabled on this server' },
  });
}

export const getPrePlannedGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const plant = typeof req.query.plant === 'string' ? req.query.plant : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : 'SUGGESTED';
    const data = await listPrePlannedGroups({ plant, status });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('getPrePlannedGroups failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list pre-planned groups' } });
  }
};

export const getPrePlannedGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const group = await getPrePlannedGroupById(req.params.id);
    if (!group) {
      res.status(404).json({ success: false, error: { message: 'Group not found' } });
      return;
    }
    res.json({ success: true, data: group });
  } catch (error) {
    logger.error('getPrePlannedGroup failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to get pre-planned group' } });
  }
};

export const postPrePlannedRebuild = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const triggeredBy = req.user?.username ? `user:${req.user.username}` : 'api';
    const result = await rebuildPrePlannedGroups(triggeredBy);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('postPrePlannedRebuild failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to rebuild pre-planned groups' } });
  }
};

export const postPrePlannedDismiss = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    await dismissPrePlannedGroup(req.params.id, reason, req.user?.id);
    res.json({ success: true, data: { dismissed: true } });
  } catch (error) {
    logger.error('postPrePlannedDismiss failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to dismiss pre-planned group' } });
  }
};

export const postPrePlannedAccept = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const rawShipmentId = typeof req.body?.shipmentId === 'string' ? req.body.shipmentId.trim() : '';
    const shipmentId = rawShipmentId || undefined;
    await acceptPrePlannedGroupLink(req.params.id, shipmentId, req.user?.id);
    res.json({ success: true, data: { accepted: true, shipmentId: shipmentId ?? null } });
  } catch (error) {
    logger.error('postPrePlannedAccept failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to accept pre-planned group' } });
  }
};

export const postPrePlannedRevert = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    await revertPrePlannedGroupToSuggested(req.params.id, req.user?.id);
    res.json({ success: true, data: { reverted: true } });
  } catch (error) {
    logger.error('postPrePlannedRevert failed', error);
    res.status(400).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to revert pre-planned group' },
    });
  }
};

export const getPrePlannedMetricsHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const data = await getPrePlannedMetrics();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('getPrePlannedMetrics failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to get pre-planned metrics' } });
  }
};
