import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { ensureUploadDir } from '../utils/fileUpload';
import {
  uploadClaimSusutExcel,
  listClaimSusutImports,
  listClaimSusutRows,
  listClaimSusutByGroupOfTransport,
} from '../controllers/claimSusut.controller';

const router = express.Router();

router.use(authenticateToken);

const uploadDir = ensureUploadDir('claim-susut');
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

// Upload + import Claim Susut excel
router.post('/upload', upload.single('file'), auditLog('CREATE', 'CLAIM_SUSUT_IMPORT'), uploadClaimSusutExcel);

// List imports
router.get('/imports', listClaimSusutImports);

// List rows (defaults to latest import if importId not provided)
router.get('/rows', listClaimSusutRows);

// Aggregate by group of transport
router.get('/by-group-of-transport', listClaimSusutByGroupOfTransport);

export default router;

