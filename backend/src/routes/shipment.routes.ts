import express from 'express';
import multer from 'multer';
import { authenticateToken, authorizePermission } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { blockWhenWithdrawn } from '../middleware/sapPresenceGuard';
import {
  getShipments,
  getShipmentById,
  getShipmentEditContext,
  getShipmentEditPayload,
  getShipmentAvailablePurchaseOrders,
  attachPurchaseOrderToShipmentHandler,
  batchSaveShipmentPoPlanQtyHandler,
  batchSaveShipmentPoKlipQtyHandler,
  updateShipment,
  getShipmentDailyDeliverablesCalendar,
  updateShipmentDailyDeliverables,
  downloadShipmentDailyPlanningDeliverablesTemplate,
  bulkUploadShipmentDailyDeliverables,
  bulkUpdateShipments,
  getVesselLoadingPorts,
  upsertVesselLoadingPort,
  deleteVesselLoadingPort,
  getContractSuggestions,
  validateContractNumber,
  getContractPurchaseOrders,
  checkStoExists,
  createShipment,
  getContractDetailsForSto,
  getStoSapPreview,
  getShippingPerformance,
  getShippingPerformanceSummary,
  getShippingPerformanceTree,
  getVesselIdle,
  updateStoQtyAssigned,
  getShipmentActivityLog,
  cancelKlipShipment,
} from '../controllers/shipment.controller';
import {
  getShipmentAtaOverride,
  updateShipmentAtaOverride,
} from '../controllers/shipmentAtaOverride.controller';
import {
  suggestShipmentEta,
  suggestShipmentVessel,
} from '../controllers/shipmentAiPlanner.controller';
import { createShipmentRemark, getShipmentRemarks } from '../controllers/remarks.controller';
import { getShipmentJettyReadiness, refreshShipmentJetty, submitShipmentToJetty } from '../controllers/shipmentJetty.controller';

const router = express.Router();

router.use(authenticateToken);

const shipmentPlanningUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(csv|xlsx|xls)$/i.test(file.originalname) ||
      [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
        'text/plain',
      ].includes(file.mimetype);
    cb(null, ok);
  },
});

// New shipment creation routes - MUST BE BEFORE parameterized routes
router.get('/contracts/suggestions', getContractSuggestions);
router.get('/contracts/validate', validateContractNumber);
router.get('/contracts/:contractId/purchase-orders', getContractPurchaseOrders);
router.get('/contracts/details', getContractDetailsForSto);
router.get('/sto-sap-preview', getStoSapPreview);
router.put('/contracts/sto-qty', auditLog('UPDATE', 'STO_QTY_ASSIGNED'), updateStoQtyAssigned);
router.get('/check-sto/:stoNumber', checkStoExists);
router.post('/suggest-vessel', suggestShipmentVessel);
router.post('/suggest-eta', suggestShipmentEta);
router.post('/', auditLog('CREATE', 'SHIPMENT'), createShipment);
router.post('/:id/cancel', auditLog('CANCEL', 'SHIPMENT'), cancelKlipShipment);

// Bulk update shipments from template CSV
router.post('/bulk-update', shipmentPlanningUpload.single('file'), auditLog('UPDATE', 'SHIPMENT'), bulkUpdateShipments);

// Daily planning deliverables (SEA Shipments)
router.get('/daily-planning-deliverables/template', downloadShipmentDailyPlanningDeliverablesTemplate);
router.post(
  '/daily-planning-deliverables/bulk-upload',
  shipmentPlanningUpload.single('file'),
  auditLog('UPDATE', 'SHIPMENT'),
  bulkUploadShipmentDailyDeliverables,
);
router.get('/daily-planning-deliverables', getShipmentDailyDeliverablesCalendar);
router.put('/:id/daily-planning-deliverables', blockWhenWithdrawn('shipment'), auditLog('UPDATE', 'SHIPMENT'), updateShipmentDailyDeliverables);

router.get('/performance/summary', getShippingPerformanceSummary);
router.get('/performance/tree', getShippingPerformanceTree);
router.get('/performance', getShippingPerformance);
router.get('/vessel-idle', getVesselIdle);
// Get all shipments
router.get('/', getShipments);

// Edit Shipment modal — lightweight sibling PO/contract resolve (before /:id)
router.get('/:id/edit-context', getShipmentEditContext);
router.get('/:id/edit-payload', getShipmentEditPayload);
router.get('/:id/remarks', getShipmentRemarks);
router.post('/:id/remarks', blockWhenWithdrawn('shipment'), auditLog('CREATE', 'SHIPMENT'), createShipmentRemark);
router.get('/:id/available-purchase-orders', getShipmentAvailablePurchaseOrders);
// Submit to Jetty (JPS): the readiness check is read-only; sending needs the edit right on Shipment Data and is audited.
router.get('/:id/jetty/readiness', authorizePermission('data.shipments', 'can_view'), getShipmentJettyReadiness);
// Reads one instruction from JPS and stores it (the same write the sweep and the webhook do), so it needs no more than viewing; JPS limits how often.
router.post('/:id/jetty/refresh', authorizePermission('data.shipments', 'can_view'), refreshShipmentJetty);
router.post(
  '/:id/jetty/submit',
  authorizePermission('data.shipments', 'can_edit'),
  blockWhenWithdrawn('shipment'),
  auditLog('SUBMIT_TO_JETTY', 'SHIPMENT'),
  submitShipmentToJetty,
);
router.post(
  '/:id/purchase-orders',
  auditLog('CREATE', 'SHIPMENT'),
  attachPurchaseOrderToShipmentHandler,
);
router.put(
  '/:id/po-plan-qty',
  auditLog('UPDATE', 'STO_QTY_ASSIGNED'),
  batchSaveShipmentPoPlanQtyHandler,
);
router.put(
  '/:id/po-klip-qty',
  auditLog('UPDATE', 'SHIPMENT'),
  batchSaveShipmentPoKlipQtyHandler,
);

// Get shipment by ID
router.get('/:id', getShipmentById);

// Update shipment
router.put('/:id', blockWhenWithdrawn('shipment'), auditLog('UPDATE', 'SHIPMENT'), updateShipment);
router.get('/:id/ata-override', getShipmentAtaOverride);
router.put('/:id/ata-override', blockWhenWithdrawn('shipment'), auditLog('UPDATE', 'SHIPMENT'), updateShipmentAtaOverride);

// Vessel loading ports routes
router.get('/:shipmentId/activity-log', getShipmentActivityLog);
router.get('/:shipmentId/loading-ports', getVesselLoadingPorts);
router.post('/:shipmentId/loading-ports', blockWhenWithdrawn('shipment', 'shipmentId'), auditLog('CREATE', 'LOADING_PORT'), upsertVesselLoadingPort);
router.put('/:shipmentId/loading-ports/:portId', blockWhenWithdrawn('shipment', 'shipmentId'), auditLog('UPDATE', 'LOADING_PORT'), upsertVesselLoadingPort);
router.delete('/:shipmentId/loading-ports/:portId', blockWhenWithdrawn('shipment', 'shipmentId'), auditLog('CANCEL', 'LOADING_PORT'), deleteVesselLoadingPort);

export default router;

