import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import {
  getShipments,
  getShipmentById,
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
  getShippingPerformance,
  updateStoQtyAssigned
} from '../controllers/shipment.controller';

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
router.put('/contracts/sto-qty', auditLog('UPDATE', 'STO_QTY_ASSIGNED'), updateStoQtyAssigned);
router.get('/check-sto/:stoNumber', checkStoExists);
router.post('/', auditLog('CREATE', 'SHIPMENT'), createShipment);

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
router.put('/:id/daily-planning-deliverables', auditLog('UPDATE', 'SHIPMENT'), updateShipmentDailyDeliverables);

router.get('/performance', getShippingPerformance);
// Get all shipments
router.get('/', getShipments);

// Get shipment by ID
router.get('/:id', getShipmentById);

// Update shipment
router.put('/:id', auditLog('UPDATE', 'SHIPMENT'), updateShipment);

// Vessel loading ports routes
router.get('/:shipmentId/loading-ports', getVesselLoadingPorts);
router.post('/:shipmentId/loading-ports', auditLog('CREATE', 'LOADING_PORT'), upsertVesselLoadingPort);
router.put('/:shipmentId/loading-ports/:portId', auditLog('UPDATE', 'LOADING_PORT'), upsertVesselLoadingPort);
router.delete('/:shipmentId/loading-ports/:portId', auditLog('DELETE', 'LOADING_PORT'), deleteVesselLoadingPort);

export default router;

