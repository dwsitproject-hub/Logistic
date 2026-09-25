import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import multer from 'multer';
import { downloadDocument, listDocuments, uploadDocumentHandler, ensureUploadDir } from '../controllers/document.controller';
import {
  buildUniqueStoredFilename,
  buildShipmentDocumentUploadSubdir,
  shipmentStructuredDocKindFromType,
} from '../utils/fileUpload';

const router = express.Router();

/*
 * Download is open; everything else on this router is not.
 *
 * JPS shows KLIP document links to its operators, and an operator may not have a KLIP account. The
 * link has to open in their browser, so the download cannot require a session. Ryan's decision on
 * 2026-09-25, on the grounds that KLIP is reachable only from the intranet.
 *
 * Deliberately the narrowest opening that satisfies that:
 *   - only GET /:id/download, so nothing can be listed, uploaded or enumerated without a session
 *   - ids are UUIDs, so a document cannot be reached by guessing
 *
 * This holds only while KLIP stays on the intranet. If it is ever published, or the link is ever
 * forwarded outside it, this route hands the file to whoever holds the URL - and the answer then is
 * a signed, expiring link rather than moving the middleware back, which would break the JPS links.
 */
router.get('/:id/download', downloadDocument);

router.use(authenticateToken);

const defaultUploadDir = ensureUploadDir();
const ALLOWED_DOC_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const documentType = String(req.body?.document_type ?? '').trim();
      const shipmentId = String(req.body?.shipment_id ?? '').trim();
      const structuredKind = shipmentStructuredDocKindFromType(documentType);
      if (structuredKind && shipmentId) {
        const subdir = buildShipmentDocumentUploadSubdir(shipmentId, structuredKind);
        cb(null, ensureUploadDir(subdir));
        return;
      }
      cb(null, defaultUploadDir);
    } catch (err) {
      cb(err as Error, defaultUploadDir);
    }
  },
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

// Download is registered above, before the auth middleware.

export default router;

