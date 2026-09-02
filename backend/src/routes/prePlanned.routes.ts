import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import {
  getPrePlannedGroup,
  getPrePlannedGroups,
  getPrePlannedMetricsHandler,
  postPrePlannedAccept,
  postPrePlannedDismiss,
  postPrePlannedManualCreate,
  postPrePlannedRebuild,
  postPrePlannedRevert,
} from '../controllers/prePlanned.controller';

const router = express.Router();

router.use(authenticateToken);

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
