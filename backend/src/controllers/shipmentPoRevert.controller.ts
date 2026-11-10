import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { revertPurchaseOrderFromShipment } from '../services/shipmentPoRevert.service';
import { invalidateAfterShipmentWrite } from '../services/shipmentWriteInvalidation.service';

/**
 * DELETE /shipments/:id/purchase-orders/:contractRowId - Revert PO: take one PO out of the operation of shipment :id and return it to Unplanned.
 * The rules, and why it deletes the PO's row instead of cancelling it, are in services/shipmentPoRevert.service.ts.
 */
export const revertPurchaseOrderHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await revertPurchaseOrderFromShipment({
      anchorShipmentUuid: String(req.params.id ?? ''),
      contractRowId: String(req.params.contractRowId ?? ''),
      userId: req.user?.id ?? null,
    });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: { message: result.message, ...(result.code ? { code: result.code } : {}) } });
    }

    // The PO is Unplanned backlog again and the operation lost a member: the list, Shipping Performance and Contract Performance all read this.
    invalidateAfterShipmentWrite(result.affectedShipmentIds);
    try {
      const { ContractQtyMoveSnapshotService } = await import('../services/contractQtyMoveSnapshot.service');
      await ContractQtyMoveSnapshotService.refreshForContracts([result.contractNumber]);
    } catch (error) {
      // best effort: the snapshot's stale flag keeps the read correct if this fails
      logger.warn('qty_move snapshot refresh after Revert PO failed', { error: error instanceof Error ? error.message : String(error) });
    }

    return res.json({
      success: true,
      message: 'PO returned to Unplanned',
      data: {
        contractNumber: result.contractNumber,
        poNumber: result.poNumber,
        removedShipmentId: result.removedShipmentId,
        survivorShipmentId: result.survivorShipmentId,
        releasedPrePlannedMembers: result.releasedPrePlannedMembers,
      },
    });
  } catch (error) {
    logger.error('Revert PO from shipment error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to revert the PO' } });
  }
};
