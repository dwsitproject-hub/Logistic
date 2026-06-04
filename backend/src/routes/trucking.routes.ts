import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import {
  getTruckingOperations,
  getTruckingOperationById,
  createTruckingOperation,
  validateContractNumber,
  updateTruckingOperation,
  getLandOpenContractSuggestions,
  getTruckingDailyDeliverablesCalendar,
  updateTruckingDailyDeliverables,
  downloadDailyPlanningDeliverablesTemplate,
  bulkUploadDailyPlanningDeliverables,
  downloadBulkCreateTruckingTemplate,
  bulkCreateTruckingOperations,
  downloadCargoReadinessTemplate,
  bulkUpdateCargoReadiness,
} from '../controllers/trucking.controller';

const router = express.Router();

router.use(authenticateToken);

const planningUpload = multer({
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

// Get all trucking operations
router.get('/', getTruckingOperations);

// Contract suggestions (LAND + Open) for create form
router.get('/contracts/suggestions', getLandOpenContractSuggestions);

// Validate contract number (legacy alias — some clients used /contracts/validate)
router.get('/contracts/validate', validateContractNumber);

// Validate contract number
router.get('/validate/contract', validateContractNumber);

// Create trucking operation
router.post('/', auditLog('CREATE', 'TRUCKING_OPERATION'), createTruckingOperation);

// Bulk create trucking operations from CSV
router.get('/bulk-create/template', downloadBulkCreateTruckingTemplate);
router.post(
  '/bulk-create',
  planningUpload.single('file'),
  auditLog('CREATE', 'TRUCKING_OPERATION'),
  bulkCreateTruckingOperations,
);

// Bulk update cargo readiness date
router.get('/cargo-readiness/template', downloadCargoReadinessTemplate);
router.post(
  '/cargo-readiness/bulk-update',
  planningUpload.single('file'),
  auditLog('UPDATE', 'TRUCKING_OPERATION'),
  bulkUpdateCargoReadiness,
);

// Calendar view: daily planning deliverables (specific paths before generic GET)
router.get('/daily-planning-deliverables/template', downloadDailyPlanningDeliverablesTemplate);
router.post(
  '/daily-planning-deliverables/bulk-upload',
  planningUpload.single('file'),
  auditLog('UPDATE', 'TRUCKING_OPERATION'),
  bulkUploadDailyPlanningDeliverables,
);
router.get('/daily-planning-deliverables', getTruckingDailyDeliverablesCalendar);
router.put('/:id/daily-planning-deliverables', auditLog('UPDATE', 'TRUCKING_OPERATION'), updateTruckingDailyDeliverables);

// Get trucking operation by ID
router.get('/:id', getTruckingOperationById);

// Update trucking operation
router.put('/:id', auditLog('UPDATE', 'TRUCKING_OPERATION'), updateTruckingOperation);

export default router;
