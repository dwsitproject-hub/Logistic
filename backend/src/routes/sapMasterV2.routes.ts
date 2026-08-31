import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { authenticateToken, authorize, authorizeSapImportsUpload, authorizeSapImportsView } from '../middleware/auth';
import * as sapMasterV2Controller from '../controllers/sapMasterV2.controller';

const router = Router();

// Use OS temp dir for transient SAP uploads. Docker volume `backend_uploads:/app/uploads` is often
// root-owned while the app runs as `nodejs`, causing EACCES and 500 from multer; files are deleted
// after import anyway (see importMasterV2Upload).
const uploadDir = path.join(os.tmpdir(), 'klip-sap-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    if (/\.(xlsx|xlsm|xlsb|xls)$/i.test(lower)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xlsm, .xlsb, .xls) are allowed'));
    }
  }
});

const catchAsync =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// Import endpoints
router.post(
  '/import',
  authenticateToken,
  authorizeSapImportsUpload,
  sapMasterV2Controller.importMasterV2
);

router.post(
  '/import-upload',
  authenticateToken,
  authorizeSapImportsUpload,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(err);
      catchAsync(sapMasterV2Controller.importMasterV2Upload)(req, res, next);
    });
  }
);

router.get(
  '/imports/active',
  authenticateToken,
  sapMasterV2Controller.getActiveImport,
);

router.get(
  '/imports',
  authenticateToken,
  authorizeSapImportsView,
  sapMasterV2Controller.getAllImports
);

router.get(
  '/imports/:importId',
  authenticateToken,
  authorizeSapImportsView,
  sapMasterV2Controller.getImportStatus
);

router.get(
  '/pending-entries',
  authenticateToken,
  sapMasterV2Controller.getPendingEntries
);

router.post(
  '/auto-import/run',
  authenticateToken,
  authorize('ADMIN'),
  catchAsync(sapMasterV2Controller.runSapFolderAutoImport),
);

router.get(
  '/auto-import/failed-file',
  authenticateToken,
  authorize('ADMIN'),
  catchAsync(sapMasterV2Controller.downloadAutoImportFailedFile),
);

export default router;

