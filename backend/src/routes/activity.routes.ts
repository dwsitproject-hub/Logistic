import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { getRecentPageActivity } from '../controllers/activity.controller';

const router = express.Router();

router.use(authenticateToken);
router.get('/recent', getRecentPageActivity);

export default router;
