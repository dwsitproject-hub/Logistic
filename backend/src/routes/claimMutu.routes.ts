import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  listClaimMutuImports,
  getClaimMutuImportById,
  listClaimMutuRows,
  getClaimMutuDashboard,
  getClaimMutuTrend,
  getClaimMutuFilterOptions,
} from '../controllers/claimMutu.controller';

const router = express.Router();

router.use(authenticateToken);

// The per-page workbook upload was replaced by Claim Data (/api/claim-data, ADMIN only).
router.post('/upload', (_req, res) => {
  res.status(410).json({
    success: false,
    error: { message: 'Uploading here is retired. Import OSCLAIM / REALCLAIM from the Claim Data page.' },
  });
});

// List imports
router.get('/imports', listClaimMutuImports);
router.get('/imports/:id', getClaimMutuImportById);

// List rows (defaults to latest import if importId not provided)
router.get('/rows', listClaimMutuRows);

// Section 1: the Pivot, Summary Per Komoditi and Rekap Per Lokasi, recomputed from the claim rows
router.get('/dashboard', getClaimMutuDashboard);

// Summary Per Unit: one point per monthly import
router.get('/trend', getClaimMutuTrend);

// Values each header filter can take in the active import
router.get('/filter-options', getClaimMutuFilterOptions);

export default router;

