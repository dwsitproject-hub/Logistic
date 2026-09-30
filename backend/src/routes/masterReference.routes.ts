import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  createMasterReference,
  deleteMasterReference,
  listMasterReferences,
  updateMasterReference,
} from '../controllers/masterReference.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/:kind', listMasterReferences);
router.post('/:kind', authorize('ADMIN'), createMasterReference);
router.put('/:kind/:id', authorize('ADMIN'), updateMasterReference);
router.delete('/:kind/:id', authorize('ADMIN'), deleteMasterReference);

export default router;
