import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { listSupplierGroups, getSupplierGroup, upsertSupplierGroup } from '../controllers/supplier-groups.controller';

const router = express.Router();
const ALL = authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT');
const EDIT = authorize('ADMIN', 'LOGISTICS', 'MANAGEMENT');

router.use(authenticateToken);

router.get('/', ALL, listSupplierGroups);
router.get('/:group_id', ALL, getSupplierGroup);
router.put('/:group_id', EDIT, upsertSupplierGroup);

export default router;
