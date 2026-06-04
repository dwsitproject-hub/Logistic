import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getAuditLogs,
  getAuditLogStats,
  getAuditLogDetail
} from '../controllers/audit.controller';

const router = express.Router();

router.use(authenticateToken);
router.use(authorize('ADMIN', 'SUPPORT'));

// Get all audit logs with filters
router.get('/', getAuditLogs);

// Get audit log statistics
router.get('/stats', getAuditLogStats);

// Get specific audit log detail
router.get('/:id', getAuditLogDetail);

export default router;

