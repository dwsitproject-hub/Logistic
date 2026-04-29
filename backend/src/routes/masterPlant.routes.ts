import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  listMasterPlants,
  createMasterPlant,
  updateMasterPlant,
  bulkUploadMasterPlants,
  deleteMasterPlant,
} from '../controllers/masterPlant.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterPlants);
router.post('/', authorize('ADMIN'), createMasterPlant);
router.put('/:id', authorize('ADMIN'), updateMasterPlant);
router.delete('/:id', authorize('ADMIN'), deleteMasterPlant);
router.post('/upload', authorize('ADMIN'), bulkUploadMasterPlants);

export default router;

