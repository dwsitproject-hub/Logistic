import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  createMasterSite,
  deleteMasterSite,
  getMasterSiteSummary,
  listMasterSites,
  updateMasterSite,
} from '../controllers/masterSite.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', listMasterSites);
// before '/:id' routes: 'summary' is not an id
router.get('/summary', getMasterSiteSummary);
router.post('/', authorize('ADMIN'), createMasterSite);
router.put('/:id', authorize('ADMIN'), updateMasterSite);
router.delete('/:id', authorize('ADMIN'), deleteMasterSite);

export default router;
