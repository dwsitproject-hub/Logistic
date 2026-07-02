import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getUserActivityDailyDetail,
  getUserActivityDailySummary,
  postUserActivityEvents,
} from '../controllers/userActivityLog.controller';

const router = express.Router();

router.use(authenticateToken);

router.post('/events', postUserActivityEvents);

router.get('/daily-summary', authorize('ADMIN'), getUserActivityDailySummary);
router.get('/daily-detail', authorize('ADMIN'), getUserActivityDailyDetail);

export default router;
