import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { ensureUploadDir } from '../utils/fileUpload';
import {
  uploadClaimMutuExcel,
  listClaimMutuImports,
  listClaimMutuRows,
  listClaimMutuDistinctValues,
  listClaimMutuByGroup,
} from '../controllers/claimMutu.controller';

const router = express.Router();

router.use(authenticateToken);

const uploadDir = ensureUploadDir('claim-mutu');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
    cb(null, unique + '_' + file.originalname.replace(/\s+/g, '_'));
  },
});

const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// Upload + import Claim Mutu excel
router.post('/upload', upload.single('file'), auditLog('CREATE', 'CLAIM_MUTU_IMPORT'), uploadClaimMutuExcel);

// List imports
router.get('/imports', listClaimMutuImports);

// List rows (defaults to latest import if importId not provided)
router.get('/rows', listClaimMutuRows);

// Aggregate by group name (selected or latest import)
router.get('/by-group', listClaimMutuByGroup);

// Distinct values for multi-select filters
router.get('/distinct-values', listClaimMutuDistinctValues);

export default router;

