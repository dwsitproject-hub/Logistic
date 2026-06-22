import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getAiKlipAgentActivityLogs,
  getAiKlipAgentNames,
} from '../controllers/aiKlipAgentActivityLog.controller';

const router = express.Router();

router.use(authenticateToken);
router.get('/logs', getAiKlipAgentActivityLogs);
router.get('/agents', getAiKlipAgentNames);

export default router;
