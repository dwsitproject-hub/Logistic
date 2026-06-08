import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import multer from 'multer';
import { downloadDocument, listDocuments, uploadDocumentHandler, ensureUploadDir } from '../controllers/document.controller';
import { buildUniqueStoredFilename } from '../utils/fileUpload';

const router = express.Router();

router.use(authenticateToken);

const uploadDir = ensureUploadDir();
const ALLOWED_DOC_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(null, buildUniqueStoredFilename(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// List documents (filter by contractId/shipmentId)
router.get('/', listDocuments);

// Upload document
router.post('/upload', upload.single('file'), auditLog('CREATE', 'DOCUMENT'), uploadDocumentHandler);

// Download document
router.get('/:id/download', downloadDocument);

export default router;

