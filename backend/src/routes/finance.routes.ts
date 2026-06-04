import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { getFinanceSummary, getPaymentById, getPayments, updatePayment } from '../controllers/finance.controller';

const router = express.Router();

router.use(authenticateToken);

router.get(
  '/summary',
  authorize('ADMIN', 'FINANCE', 'MANAGEMENT', 'TRADING', 'LOGISTICS', 'SUPPORT'),
  getFinanceSummary
);

router.get(
  '/payments',
  authorize('ADMIN', 'FINANCE', 'MANAGEMENT', 'TRADING', 'LOGISTICS', 'SUPPORT'),
  getPayments
);

router.get(
  '/payments/:id',
  authorize('ADMIN', 'FINANCE'),
  getPaymentById
);

router.patch(
  '/payments/:id',
  authorize('ADMIN', 'FINANCE'),
  auditLog('UPDATE', 'PAYMENT'),
  updatePayment
);

export default router;

