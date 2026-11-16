import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  createMasterCompany,
  deleteMasterCompany,
  getMasterCompanySummary,
  listMasterCompanies,
  updateMasterCompany,
} from '../controllers/masterCompany.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterCompanies);
// before '/:id' routes: 'summary' is not an id
router.get('/summary', getMasterCompanySummary);
router.post('/', authorize('ADMIN'), createMasterCompany);
router.put('/:id', authorize('ADMIN'), updateMasterCompany);
router.delete('/:id', authorize('ADMIN'), deleteMasterCompany);

export default router;
