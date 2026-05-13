import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, authorize } from '../middleware/auth';
import * as sapMasterV2Controller from '../controllers/sapMasterV2.controller';

const router = Router();

// Ensure uploads directory exists (matches supplier.routes.ts; avoids 500 when cwd lacks uploads/)
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// Import endpoints
router.post(
  '/import',
  authenticateToken,
  authorize('ADMIN'),
  sapMasterV2Controller.importMasterV2
);

router.post(
  '/import-upload',
  authenticateToken,
  authorize('ADMIN'),
  upload.single('file'),
  sapMasterV2Controller.importMasterV2Upload
);

router.get(
  '/imports',
  authenticateToken,
  authorize('ADMIN', 'MANAGEMENT'),
  sapMasterV2Controller.getAllImports
);

router.get(
  '/imports/:importId',
  authenticateToken,
  authorize('ADMIN', 'MANAGEMENT'),
  sapMasterV2Controller.getImportStatus
);

router.get(
  '/pending-entries',
  authenticateToken,
  sapMasterV2Controller.getPendingEntries
);

export default router;

