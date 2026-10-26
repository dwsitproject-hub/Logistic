import express from 'express';
import { authenticateToken, authorizeAnyPermission, authorizePermission } from '../middleware/auth';
import {
  commercialDocumentUpload,
  deleteCommercialDocument,
  downloadCommercialDocument,
  downloadTandaTerima,
  getCommercialDocumentFiles,
  getCommercialDocumentHistory,
  getCommercialDocuments,
  getCommercialDocumentsCompletenessByPlant,
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

/*
 * Every route checks the page permission on the server. The page keys used to be checked in the browser only, so any signed-in
 * KLIP user could list, view and download commercial documents through the API; with Commercial Documents becoming its own app
 * (same backend), the API is the only gate both front ends share. Per-type upload rights stay in the controller
 * (data.commercial_documents.upload.<type>), delete keeps its own key.
 */
const canViewDocuments = authorizePermission('page.commercial_documents', 'can_view');
const canEditDocuments = authorizePermission('page.commercial_documents', 'can_edit');
// The dashboard reads it; KLIP's Documents page prefetches it too.
const canViewCompleteness = authorizeAnyPermission(['page.commercial_dashboard', 'page.commercial_documents'], 'can_view');

router.get('/', authenticateToken, canViewDocuments, getCommercialDocuments);
router.get('/summary', authenticateToken, canViewDocuments, getCommercialDocumentsSummary);
router.get(
  '/completeness-by-plant',
  authenticateToken,
  canViewCompleteness,
  getCommercialDocumentsCompletenessByPlant,
);
router.get('/history/:poNumber', authenticateToken, canViewDocuments, getCommercialDocumentHistory);
router.get('/files/:poNumber', authenticateToken, canViewDocuments, getCommercialDocumentFiles);
router.post('/upload', authenticateToken, canViewDocuments, commercialDocumentUpload.single('file'), uploadCommercialDocument);
router.post(
  '/ocr/settlement-invoice',
  authenticateToken,
  canViewDocuments,
  settlementInvoiceOcrUpload,
  ocrSettlementInvoice,
);
router.get('/settlement-invoice/:poNumber', authenticateToken, canViewDocuments, getSettlementInvoiceSummary);
router.put('/settlement-invoice', authenticateToken, canEditDocuments, upsertSettlementInvoiceSummary);
router.get('/file/:id/view', authenticateToken, canViewDocuments, viewCommercialDocument);
router.get('/file/:id/download', authenticateToken, canViewDocuments, downloadCommercialDocument);
router.delete(
  '/file/:id',
  authenticateToken,
  authorizePermission('data.commercial_documents', 'can_delete'),
  deleteCommercialDocument,
);
router.post('/tanda-terima/download', authenticateToken, canViewDocuments, downloadTandaTerima);

export default router;
