import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { isPrePlannedGroupingEnabled } from '../config/prePlannedConfig';
import {
  acceptPrePlannedGroupLink,
  createManualPrePlannedGroup,
  dismissPrePlannedGroup,
  getPrePlannedGroupById,
  getPrePlannedMetrics,
  listPrePlannedGroups,
  rebuildPrePlannedGroups,
  revertPrePlannedGroupToSuggested,
} from '../services/prePlannedGroup.service';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import {
  fetchShipmentGroupingTemplateRows,
  parseGroupingTemplateQueryFromRequest,
} from '../utils/shipmentPreplannedGroupingTemplateSql';
import { buildShipmentGroupingTemplateXlsxBuffer } from '../utils/shipmentPreplannedGroupingUpload';
import { fetchMasterVesselNamesForGroupingTemplate } from '../utils/shipmentGroupingPlannedResolve';
import { applyShipmentGroupingBulkUpload } from '../services/shipmentGroupingBulkUpload.service';

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
    invalidateShipmentsListCache();
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
    invalidateShipmentsListCache();
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
    invalidateShipmentsListCache();
    res.json({ success: true, data: { accepted: true, shipmentId: shipmentId ?? null } });
  } catch (error) {
    logger.error('postPrePlannedAccept failed', error);
    res.status(500).json({ success: false, error: { message: 'Failed to accept pre-planned group' } });
  }
};

export const postPrePlannedManualCreate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const rawIds = Array.isArray(req.body?.contractIds) ? req.body.contractIds : [];
    const contractIds = rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
    if (contractIds.length < 1) {
      res.status(400).json({
        success: false,
        error: { message: 'Select at least 1 contract to create a manual Preplanned group' },
      });
      return;
    }
    const group = await createManualPrePlannedGroup(contractIds, req.user?.id);
    invalidateShipmentsListCache();
    res.json({ success: true, data: { group } });
  } catch (error) {
    logger.error('postPrePlannedManualCreate failed', error);
    res.status(400).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to create manual pre-planned group',
      },
    });
  }
};

export const postPrePlannedRevert = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    await revertPrePlannedGroupToSuggested(req.params.id, req.user?.id);
    invalidateShipmentsListCache();
    res.json({ success: true, data: { reverted: true } });
  } catch (error) {
    logger.error('postPrePlannedRevert failed', error);
    res.status(400).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to revert pre-planned group' },
    });
  }
};

export const getPrePlannedGroupingTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const filters = parseGroupingTemplateQueryFromRequest(req.query as Record<string, unknown>);
    const { rows, truncated, limit } = await fetchShipmentGroupingTemplateRows(filters);
    const vesselNames = await fetchMasterVesselNamesForGroupingTemplate();
    const buf = buildShipmentGroupingTemplateXlsxBuffer(rows, { vesselNames });
    const filename = 'shipment-unplanned-grouping-template.xlsx';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Klip-Template-Row-Count', String(rows.length));
    res.setHeader('X-Klip-Template-Limit', String(limit));
    res.setHeader('X-Klip-Template-Truncated', truncated ? '1' : '0');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, X-Klip-Template-Truncated, X-Klip-Template-Row-Count, X-Klip-Template-Limit',
    );
    res.send(buf);
  } catch (error) {
    logger.error('getPrePlannedGroupingTemplate failed', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to download Unplanned grouping template' },
    });
  }
};

export const postPrePlannedGroupingBulkUpload = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!isPrePlannedGroupingEnabled()) {
      disabled(res);
      return;
    }
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      res.status(400).json({ success: false, error: { message: 'File is required (Excel .xlsx)' } });
      return;
    }
    if (!/\.(xlsx|xls)$/i.test(file.originalname || '')) {
      res.status(400).json({
        success: false,
        error: { message: 'Upload requires an Excel file (.xlsx)' },
      });
      return;
    }
    const data = await applyShipmentGroupingBulkUpload(file.buffer, req.user?.id);
    invalidateShipmentsListCache();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('postPrePlannedGroupingBulkUpload failed', error);
    res.status(400).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to upload grouping template',
      },
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
