import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  commercialDocumentUpload,
  downloadCommercialDocument,
  getCommercialDocumentFiles,
  getCommercialDocumentHistory,
  getCommercialDocuments,
  uploadCommercialDocument,
  viewCommercialDocument,
} from '../controllers/commercialDocuments.controller';

const router = express.Router();

router.get('/', authenticateToken, getCommercialDocuments);
router.get('/history/:contractExtNo', authenticateToken, getCommercialDocumentHistory);
router.get('/files/:contractExtNo', authenticateToken, getCommercialDocumentFiles);
router.post('/upload', authenticateToken, commercialDocumentUpload.single('file'), uploadCommercialDocument);
router.get('/file/:id/view', authenticateToken, viewCommercialDocument);
router.get('/file/:id/download', authenticateToken, downloadCommercialDocument);

export default router;
