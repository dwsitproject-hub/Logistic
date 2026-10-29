import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import multer from 'multer';
import { downloadDocument, viewDocument, listDocuments, uploadDocumentHandler, ensureUploadDir } from '../controllers/document.controller';
import { buildUniqueStoredFilename } from '../utils/fileUpload';

const router = express.Router();

/*
 * Download is open; everything else on this router is not.
 *
 * JPS shows KLIP document links to its operators, and an operator may not have a KLIP account. The
 * link has to open in their browser, so the download cannot require a session. Ryan's decision on
 * 2026-09-25, on the grounds that KLIP is reachable only from the intranet.
 *
 * Deliberately the narrowest opening that satisfies that:
 *   - only GET /:id/download and GET /:id/view, so nothing can be listed, uploaded or enumerated without a session
 *   - ids are UUIDs, so a document cannot be reached by guessing
 *
 * This holds only while KLIP stays on the intranet. If it is ever published, or the link is ever
 * forwarded outside it, this route hands the file to whoever holds the URL - and the answer then is
 * a signed, expiring link rather than moving the middleware back, which would break the JPS links.
 */
router.get('/:id/download', downloadDocument);
// Open for the same reason: JPS shows the Contract / SI / BL links KLIP sends it. Inline, and its origin may frame it (see viewDocument).
router.get('/:id/view', viewDocument);

router.use(authenticateToken);

const defaultUploadDir = ensureUploadDir();
const ALLOWED_DOC_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
// Always the upload root. The folder a document belongs in is decided by the handler once the whole body is parsed (document.controller.ts): every client appends
// `file` BEFORE document_type / shipment_id, so this callback never saw them, and a folder chosen here only left empty folders behind.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, defaultUploadDir),
  filename: (_req, file, cb) => {
    cb(null, buildUniqueStoredFilename(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();
    // A dropped PDF sometimes arrives as octet-stream or with an empty type.
    const pdfByName = name.endsWith('.pdf') && (mime === '' || mime === 'application/octet-stream' || mime === 'application/pdf');
    if (ALLOWED_DOC_MIMES.has(mime) || pdfByName) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
  },
});

// List documents (filter by contractId/shipmentId)
router.get('/', listDocuments);

// Upload document
router.post('/upload', upload.single('file'), auditLog('CREATE', 'DOCUMENT'), uploadDocumentHandler);

// Download is registered above, before the auth middleware.

export default router;

