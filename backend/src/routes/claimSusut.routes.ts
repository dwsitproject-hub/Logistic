import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  listClaimSusutImports,
  listClaimSusutRows,
  listClaimSusutByGroupOfTransport,
  listClaimSusutByVendor,
  getClaimSusutFilterOptions,
  getClaimSusutSummary,
  getClaimSusutRealized,
  getClaimSusutTree,
  getClaimSusutImportById,
} from '../controllers/claimSusut.controller';

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
router.get('/imports', listClaimSusutImports);
router.get('/imports/:id', getClaimSusutImportById);

router.get('/filter-options', getClaimSusutFilterOptions);
router.get('/summary', getClaimSusutSummary);
router.get('/realized', getClaimSusutRealized);
router.get('/tree', getClaimSusutTree);

// List rows (defaults to latest import if importId not provided)
router.get('/rows', listClaimSusutRows);

// Aggregate by group of transport
router.get('/by-group-of-transport', listClaimSusutByGroupOfTransport);
router.get('/by-vendor', listClaimSusutByVendor);

export default router;

