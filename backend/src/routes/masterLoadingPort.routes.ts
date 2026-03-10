import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  listMasterLoadingPorts,
  createMasterLoadingPort,
  updateMasterLoadingPort,
  bulkUploadMasterLoadingPorts,
} from '../controllers/masterLoadingPort.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterLoadingPorts);
router.post('/', authorize('ADMIN'), createMasterLoadingPort);
router.put('/:id', authorize('ADMIN'), updateMasterLoadingPort);
router.post('/upload', authorize('ADMIN'), bulkUploadMasterLoadingPorts);

export default router;

