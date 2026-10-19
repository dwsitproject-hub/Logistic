import express from 'express';
import multer from 'multer';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  listMasterVessels,
  getMasterVesselFilterOptions,
  createMasterVessel,
  updateMasterVessel,
  deleteMasterVessel,
  importJovinMasterVessels,
} from '../controllers/masterVessel.controller';
import { approveReviewVessel, listReviewVessels, mergeReviewVessel } from '../controllers/masterVesselReview.controller';

const router = express.Router();
const jovinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.use(authenticateToken);

router.get('/', listMasterVessels);
router.get('/filter-options', getMasterVesselFilterOptions);
// vessels KLIP registered itself from a SAP vessel name and is not sure of (services/registerVesselFromSap.service.ts)
router.get('/review', listReviewVessels);
router.post('/:id/review/approve', authorize('ADMIN'), approveReviewVessel);
router.post('/:id/review/merge', authorize('ADMIN'), mergeReviewVessel);

router.post('/', authorize('ADMIN'), createMasterVessel);
router.put('/:id', authorize('ADMIN'), updateMasterVessel);
router.delete('/:id', authorize('ADMIN'), deleteMasterVessel);
router.post(
  '/import-jovin',
  authorize('ADMIN'),
  jovinUpload.single('file'),
  importJovinMasterVessels,
);

export default router;
