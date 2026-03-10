import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  listMasterVessels,
  createMasterVessel,
  updateMasterVessel,
  bulkUploadMasterVessels,
} from '../controllers/masterVessel.controller';

const router = express.Router();

router.use(authenticateToken);

// View list
router.get('/', listMasterVessels);

// Create / edit / bulk upload – restrict to ADMIN or roles with data.master_vessels permissions (enforced via role-permissions on frontend)
router.post('/', authorize('ADMIN'), createMasterVessel);
router.put('/:id', authorize('ADMIN'), updateMasterVessel);
router.post('/upload', authorize('ADMIN'), bulkUploadMasterVessels);

export default router;

