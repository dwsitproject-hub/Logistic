import express from 'express';
import multer from 'multer';
import path from 'path';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { ensureUploadDir, importDataSubdir } from '../utils/fileUpload';
import {
  uploadClaimData,
  listClaimDataUploads,
  getClaimDataStatus,
  getClaimAutoImportStatus,
  syncClaimAutoImport,
} from '../controllers/claimData.controller';

const router = express.Router();

// Claim Data is an ingestion page: ADMIN only (same posture as the other SAP imports).
router.use(authenticateToken, authorize('ADMIN'));

// A file imported by hand is kept as a backup in IMPORT DATA/claim-data/manual on the upload root.
const uploadDir = ensureUploadDir(importDataSubdir('claim-data', 'manual'));
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
    cb(null, unique + '_' + file.originalname.replace(/\s+/g, '_'));
  },
});

// SAP's .xls export is sometimes served as octet-stream or text/html, so the extension decides.
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.xls' || ext === '.xlsx') cb(null, true);
    else cb(new Error('Only .xls or .xlsx files are accepted'));
  },
});

router.post('/upload', upload.single('file'), auditLog('CREATE', 'CLAIM_DATA_IMPORT'), uploadClaimData);
router.get('/uploads', listClaimDataUploads);
router.get('/status', getClaimDataStatus);
router.get('/auto-import/status', getClaimAutoImportStatus);
router.post('/auto-import/sync', auditLog('CREATE', 'CLAIM_DATA_AUTO_IMPORT'), syncClaimAutoImport);

export default router;
