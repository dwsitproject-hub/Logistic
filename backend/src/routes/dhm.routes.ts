import express from 'express';
import { syncMasterCatalogToDhm } from '../controllers/dhmSync.controller';
import { authenticateToken, authorize } from '../middleware/auth';

const router = express.Router();

router.use(authenticateToken);
router.post('/sync', authorize('ADMIN'), syncMasterCatalogToDhm);

export default router;
