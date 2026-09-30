import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  createMasterCompany,
  deleteMasterCompany,
  listMasterCompanies,
  updateMasterCompany,
} from '../controllers/masterCompany.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterCompanies);
router.post('/', authorize('ADMIN'), createMasterCompany);
router.put('/:id', authorize('ADMIN'), updateMasterCompany);
router.delete('/:id', authorize('ADMIN'), deleteMasterCompany);

export default router;
