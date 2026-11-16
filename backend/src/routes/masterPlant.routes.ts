import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getMasterPlantSummary,
  listMasterPlants,
  createMasterPlant,
  updateMasterPlant,
  bulkUploadMasterPlants,
  deleteMasterPlant,
} from '../controllers/masterPlant.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterPlants);
// before the '/:id' routes: 'summary' is not an id
router.get('/summary', getMasterPlantSummary);
router.post('/', authorize('ADMIN'), createMasterPlant);
router.put('/:id', authorize('ADMIN'), updateMasterPlant);
router.delete('/:id', authorize('ADMIN'), deleteMasterPlant);
router.post('/upload', authorize('ADMIN'), bulkUploadMasterPlants);

export default router;

