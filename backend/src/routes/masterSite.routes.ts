import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  createMasterSite,
  deleteMasterSite,
  listMasterSites,
  updateMasterSite,
} from '../controllers/masterSite.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterSites);
router.post('/', authorize('ADMIN'), createMasterSite);
router.put('/:id', authorize('ADMIN'), updateMasterSite);
router.delete('/:id', authorize('ADMIN'), deleteMasterSite);

export default router;
