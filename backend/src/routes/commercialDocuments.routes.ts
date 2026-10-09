import express from 'express';
import { authenticateToken, authorizePermission } from '../middleware/auth';
import {
  commercialDocumentUpload,
  deleteCommercialDocument,
  downloadCommercialDocument,
  downloadTandaTerima,
  getCommercialDocumentFiles,
  getCommercialDocumentHistory,
  getCommercialDocuments,
  getCommercialDocumentsSummary,
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
router.get('/summary', authenticateToken, getCommercialDocumentsSummary);
router.get('/history/:poNumber', authenticateToken, getCommercialDocumentHistory);
router.get('/files/:poNumber', authenticateToken, getCommercialDocumentFiles);
router.post('/upload', authenticateToken, commercialDocumentUpload.single('file'), uploadCommercialDocument);
router.post(
  '/ocr/settlement-invoice',
  authenticateToken,
  settlementInvoiceOcrUpload,
  ocrSettlementInvoice,
);
router.get('/settlement-invoice/:poNumber', authenticateToken, getSettlementInvoiceSummary);
router.put('/settlement-invoice', authenticateToken, upsertSettlementInvoiceSummary);
router.get('/file/:id/view', authenticateToken, viewCommercialDocument);
router.get('/file/:id/download', authenticateToken, downloadCommercialDocument);
router.delete(
  '/file/:id',
  authenticateToken,
  authorizePermission('data.commercial_documents', 'can_delete'),
  deleteCommercialDocument,
);
router.post('/tanda-terima/download', authenticateToken, downloadTandaTerima);

export default router;
