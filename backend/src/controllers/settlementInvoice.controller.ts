import { Response } from 'express';
import multer from 'multer';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { runSettlementInvoiceOcr } from '../services/settlementInvoiceOcr.service';
import type { SettlementInvoiceFields } from '../utils/settlementInvoiceParser';

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype || '';
    const name = file.originalname.toLowerCase();
    const ok =
      mime === 'application/pdf' ||
      name.endsWith('.pdf') ||
      /^image\/(png|jpe?g|webp)$/i.test(mime) ||
      /\.(png|jpe?g|webp)$/i.test(name);
    if (ok) cb(null, true);
    else cb(new Error('Only PDF or image files (PNG/JPEG) are allowed for OCR'));
  },
});

export const settlementInvoiceOcrUpload = memoryUpload.single('file');

function parseOptionalAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSummaryRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    contract_ext_no: row.contract_ext_no,
    commercial_document_file_id: row.commercial_document_file_id,
    contract_id: row.contract_id,
    gross_amount: row.gross_amount != null ? Number(row.gross_amount) : null,
    discount_amount: row.discount_amount != null ? Number(row.discount_amount) : null,
    down_payment: row.down_payment != null ? Number(row.down_payment) : null,
    subtotal: row.subtotal != null ? Number(row.subtotal) : null,
    tax_base_amount: row.tax_base_amount != null ? Number(row.tax_base_amount) : null,
    vat_12_percent: row.vat_12_percent != null ? Number(row.vat_12_percent) : null,
    total_payable: row.total_payable != null ? Number(row.total_payable) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const ocrSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }

    const result = await runSettlementInvoiceOcr(
      file.buffer,
      file.mimetype || '',
      file.originalname || 'document',
    );

    return res.json({
      success: true,
      data: {
        fields: result.fields,
        extractedCount: result.extractedCount,
        totalFields: result.totalFields,
        partial: result.partial,
        source: result.source,
        message: result.partial
          ? 'Partial OCR read. Please verify fields.'
          : 'OCR completed successfully.',
      },
    });
  } catch (err) {
    logger.error('ocrSettlementInvoice error:', err);
    return res.status(500).json({
      success: false,
      error: {
        message: 'OCR processing failed. You can enter values manually.',
      },
    });
  }
};

export const getSettlementInvoiceSummary = async (req: AuthRequest, res: Response) => {
  try {
    const contractExtNo = String(req.params.contractExtNo || '').trim();
    if (!contractExtNo) {
      return res.status(400).json({ success: false, error: { message: 'contract_ext_no is required' } });
    }

    const result = await query(
      `SELECT * FROM settlement_invoice_summaries WHERE contract_ext_no = $1 LIMIT 1`,
      [contractExtNo],
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    return res.json({ success: true, data: mapSummaryRow(result.rows[0]) });
  } catch (err) {
    logger.error('getSettlementInvoiceSummary error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch settlement summary' } });
  }
};

export const upsertSettlementInvoiceSummary = async (req: AuthRequest, res: Response) => {
  try {
    const contractExtNo = String(req.body?.contract_ext_no || '').trim();
    if (!contractExtNo) {
      return res.status(400).json({ success: false, error: { message: 'contract_ext_no is required' } });
    }

    const fields: SettlementInvoiceFields = {
      gross_amount: parseOptionalAmount(req.body?.gross_amount),
      discount_amount: parseOptionalAmount(req.body?.discount_amount),
      down_payment: parseOptionalAmount(req.body?.down_payment),
      subtotal: parseOptionalAmount(req.body?.subtotal),
      tax_base_amount: parseOptionalAmount(req.body?.tax_base_amount),
      vat_12_percent: parseOptionalAmount(req.body?.vat_12_percent),
      total_payable: parseOptionalAmount(req.body?.total_payable),
    };

    const commercialDocumentFileId = req.body?.commercial_document_file_id
      ? String(req.body.commercial_document_file_id).trim()
      : null;
    const contractId = req.body?.contract_id ? String(req.body.contract_id).trim() : null;
    const userId = req.user?.id ?? null;

    const result = await query(
      `INSERT INTO settlement_invoice_summaries (
         contract_ext_no,
         commercial_document_file_id,
         contract_id,
         gross_amount,
         discount_amount,
         down_payment,
         subtotal,
         tax_base_amount,
         vat_12_percent,
         total_payable,
         created_by,
         updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (contract_ext_no) DO UPDATE SET
         commercial_document_file_id = COALESCE(EXCLUDED.commercial_document_file_id, settlement_invoice_summaries.commercial_document_file_id),
         contract_id = COALESCE(EXCLUDED.contract_id, settlement_invoice_summaries.contract_id),
         gross_amount = EXCLUDED.gross_amount,
         discount_amount = EXCLUDED.discount_amount,
         down_payment = EXCLUDED.down_payment,
         subtotal = EXCLUDED.subtotal,
         tax_base_amount = EXCLUDED.tax_base_amount,
         vat_12_percent = EXCLUDED.vat_12_percent,
         total_payable = EXCLUDED.total_payable,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        contractExtNo,
        commercialDocumentFileId,
        contractId,
        fields.gross_amount,
        fields.discount_amount,
        fields.down_payment,
        fields.subtotal,
        fields.tax_base_amount,
        fields.vat_12_percent,
        fields.total_payable,
        userId,
      ],
    );

    return res.json({
      success: true,
      message: 'Settlement invoice summary saved',
      data: mapSummaryRow(result.rows[0]),
    });
  } catch (err) {
    logger.error('upsertSettlementInvoiceSummary error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to save settlement summary' } });
  }
};
