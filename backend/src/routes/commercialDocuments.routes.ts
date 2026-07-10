import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  commercialDocumentUpload,
  downloadCommercialDocument,
  downloadTandaTerima,
  getCommercialDocumentFiles,
  getCommercialDocumentHistory,
  getCommercialDocuments,
  uploadCommercialDocument,
  viewCommercialDocument,
} from '../controllers/commercialDocuments.controller';
import {
  getSettlementInvoiceSummary,
  ocrSettlementInvoice,
  settlementInvoiceOcrUpload,
  upsertSettlementInvoiceSummary,
} from '../controllers/settlementInvoice.controller';

const router = express.Router();

router.get('/', authenticateToken, getCommercialDocuments);
router.get('/history/:contractExtNo', authenticateToken, getCommercialDocumentHistory);
router.get('/files/:contractExtNo', authenticateToken, getCommercialDocumentFiles);
router.post('/upload', authenticateToken, commercialDocumentUpload.single('file'), uploadCommercialDocument);
router.post(
  '/ocr/settlement-invoice',
  authenticateToken,
  settlementInvoiceOcrUpload,
  ocrSettlementInvoice,
);
router.get('/settlement-invoice/:contractExtNo', authenticateToken, getSettlementInvoiceSummary);
router.put('/settlement-invoice', authenticateToken, upsertSettlementInvoiceSummary);
router.get('/file/:id/view', authenticateToken, viewCommercialDocument);
router.get('/file/:id/download', authenticateToken, downloadCommercialDocument);
router.post('/tanda-terima/download', authenticateToken, downloadTandaTerima);

export default router;
