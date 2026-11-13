import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getMasterLoadingPortSummary,
  listMasterLoadingPorts,
  createMasterLoadingPort,
  updateMasterLoadingPort,
  bulkUploadMasterLoadingPorts,
  deleteMasterLoadingPort,
} from '../controllers/masterLoadingPort.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterLoadingPorts);
// before the '/:id' routes: 'summary' is not an id
router.get('/summary', getMasterLoadingPortSummary);
router.post('/', authorize('ADMIN'), createMasterLoadingPort);
router.put('/:id', authorize('ADMIN'), updateMasterLoadingPort);
router.delete('/:id', authorize('ADMIN'), deleteMasterLoadingPort);
router.post('/upload', authorize('ADMIN'), bulkUploadMasterLoadingPorts);

export default router;

