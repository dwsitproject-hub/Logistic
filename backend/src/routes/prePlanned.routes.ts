import express from 'express';
import multer from 'multer';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import {
  getPrePlannedGroup,
  getPrePlannedGroups,
  getPrePlannedGroupingTemplate,
  getPrePlannedMetricsHandler,
  postPrePlannedAccept,
  postPrePlannedDismiss,
  postPrePlannedGroupingBulkUpload,
  postPrePlannedManualCreate,
  postPrePlannedRebuild,
  postPrePlannedRevert,
} from '../controllers/prePlanned.controller';

const router = express.Router();

router.use(authenticateToken);

const groupingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(xlsx|xls)$/i.test(file.originalname) ||
      [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ].includes(file.mimetype);
    cb(null, ok);
  },
});

router.get(
  '/grouping-template',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  getPrePlannedGroupingTemplate,
);
router.post(
  '/grouping-bulk-upload',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  groupingUpload.single('file'),
  auditLog('MANUAL_CREATE', 'PRE_PLANNED_GROUP'),
  postPrePlannedGroupingBulkUpload,
);

router.get('/groups', getPrePlannedGroups);
router.get('/groups/:id', getPrePlannedGroup);
router.get('/metrics', getPrePlannedMetricsHandler);
router.post(
  '/rebuild',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  auditLog('REBUILD', 'PRE_PLANNED'),
  postPrePlannedRebuild,
);
router.post(
  '/groups/manual',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  auditLog('MANUAL_CREATE', 'PRE_PLANNED_GROUP'),
  postPrePlannedManualCreate,
);
router.post(
  '/groups/:id/dismiss',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  auditLog('DISMISS', 'PRE_PLANNED_GROUP'),
  postPrePlannedDismiss,
);
router.post(
  '/groups/:id/accept',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  auditLog('ACCEPT', 'PRE_PLANNED_GROUP'),
  postPrePlannedAccept,
);
router.post(
  '/groups/:id/revert',
  authorize('ADMIN', 'MANAGEMENT', 'LOGISTICS'),
  auditLog('REVERT', 'PRE_PLANNED_GROUP'),
  postPrePlannedRevert,
);

export default router;
