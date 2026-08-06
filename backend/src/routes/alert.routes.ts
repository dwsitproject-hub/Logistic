import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getMissingEtaCargoReadinessAlerts,
  runContractEtaReminderAlerts,
} from '../controllers/alert.controller';

const router = express.Router();

router.use(authenticateToken);
router.get('/missing-eta-cargo-readiness', getMissingEtaCargoReadinessAlerts);
router.post(
  '/contract-eta-reminder/run',
  authorize('ADMIN'),
  runContractEtaReminderAlerts,
);

export default router;
