import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import {
  buildCommercialDocumentStoredName,
  commercialDocumentMonthFolder,
  commercialDocumentTypeLabel,
  documentTypesForCategory,
  isCommercialDocumentType,
} from '../utils/commercialDocumentsConstants';
import {
  buildCommercialDocumentsListQuery,
  buildCommercialDocumentsSummaryQuery,
} from '../utils/commercialDocumentsQuerySql';
import {
  ensureUploadDir,
  resolveUploadAbsolutePath,
  toRelativeUploadPath,
} from '../utils/fileUpload';
import { scanFileWithClamdIfConfigured } from '../services/clamScan.service';

function defaultYtdRange(): { dateFrom: string; dateTo: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-${m}-${day}` };
}

function mapRow(row: Record<string, unknown>) {
  const qty = Number(row.quantity_ordered) || 0;
  const unitPrice = Number(row.unit_price) || 0;
  return {
    id: row.id,
    contract_id: row.contract_id,
    contract_ext_no: row.contract_ext_no,
    po_number: row.po_number,
    buyer: row.buyer,
    supplier: row.supplier,
    product: row.product,
    incoterm: row.incoterm,
    contract_date: row.contract_date,
    payment_due_date: row.payment_due_date,
    dp_due_date: row.dp_due_date,
    quantity_ordered: qty,
    unit_price: unitPrice,
    total_price: qty * unitPrice,
    currency: row.currency,
    company_name: row.company_name,
    plant_site: row.plant_site,
    transport_mode: row.transport_mode,
    b2b_flag: row.b2b_flag,
    contract_reference_po: row.contract_reference_po,
    import_status: row.import_status,
    status: row.status,
    is_open: row.is_open,
    uploaded_count: row.uploaded_count,
    doc_contract: row.doc_contract,
    doc_addendum_contract: row.doc_addendum_contract,
    doc_invoice_fp_dp: row.doc_invoice_fp_dp,
    doc_invoice_fp_payoff: row.doc_invoice_fp_payoff,
    doc_invoice_fp_full: row.doc_invoice_fp_full,
  };
}

function parseDocumentStatus(value: string | undefined): 'checked' | 'unchecked' | null {
  if (value === 'checked' || value === 'unchecked') return value;
  return null;
}

export const getCommercialDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const ytd = defaultYtdRange();
    const q = req.query as Record<string, string | undefined>;
    const dateFrom = q.dateFrom || ytd.dateFrom;
    const dateTo = q.dateTo || ytd.dateTo;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 50;

    const listParams = {
      dateFrom,
      dateTo,
      search: q.search || null,
      documentType: q.documentType || null,
      documentStatus: parseDocumentStatus(q.documentStatus),
      incoterm: q.incoterm || null,
      product: q.product || null,
      supplier: q.supplier || null,
      plant: q.plant || null,
      page,
      limit,
    };

    const { sql, countSql, values } = buildCommercialDocumentsListQuery(listParams);
    const [rowsResult, countResult, summaryResult] = await Promise.all([
      query(sql, values),
      query(countSql, values.slice(0, values.length - 2)),
      query(
        buildCommercialDocumentsSummaryQuery({ dateFrom, dateTo }).sql,
        buildCommercialDocumentsSummaryQuery({ dateFrom, dateTo }).values,
      ),
    ]);

    const total = Number(countResult.rows[0]?.total ?? 0);
    const summaryRow = summaryResult.rows[0] ?? {};
    const openCount = Number(summaryRow.open_contract_count ?? 0);

    const buildCard = (checkedKey: string) => {
      const checked = Number(summaryRow[checkedKey] ?? 0);
      const pct = openCount > 0 ? Math.round((checked / openCount) * 100) : 0;
      return { openCount, checkedCount: checked, checkedPct: pct, uncheckedPct: 100 - pct };
    };

    return res.json({
      success: true,
      data: {
        rows: rowsResult.rows.map(mapRow),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        summary: {
          contract: buildCard('checked_contract'),
          addendum_contract: buildCard('checked_addendum_contract'),
          invoice_fp_dp: buildCard('checked_invoice_fp_dp'),
          invoice_fp_payoff: buildCard('checked_invoice_fp_payoff'),
          invoice_fp_full: buildCard('checked_invoice_fp_full'),
        },
        filters: { dateFrom, dateTo },
      },
    });
  } catch (err) {
    logger.error('getCommercialDocuments error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch commercial documents' } });
  }
};

export const getCommercialDocumentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const contractExtNo = String(req.params.contractExtNo || '').trim();
    if (!contractExtNo) {
      return res.status(400).json({ success: false, error: { message: 'contract_ext_no is required' } });
    }
    const result = await query(
      `SELECT id, contract_ext_no, document_type, action_type, file_name, user_name, created_at
       FROM commercial_document_history
       WHERE contract_ext_no = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [contractExtNo],
    );
    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        ...row,
        document_type_label: commercialDocumentTypeLabel(String(row.document_type || '')),
      })),
    });
  } catch (err) {
    logger.error('getCommercialDocumentHistory error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch history' } });
  }
};

export const getCommercialDocumentFiles = async (req: AuthRequest, res: Response) => {
  try {
    const contractExtNo = String(req.params.contractExtNo || '').trim();
    if (!contractExtNo) {
      return res.status(400).json({ success: false, error: { message: 'contract_ext_no is required' } });
    }
    const result = await query(
      `SELECT id, contract_ext_no, document_type, file_name, file_path, checked, created_at, updated_at
       FROM commercial_document_files
       WHERE contract_ext_no = $1
       ORDER BY document_type ASC, created_at ASC`,
      [contractExtNo],
    );
    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        ...row,
        document_type_label: commercialDocumentTypeLabel(String(row.document_type || '')),
      })),
    });
  } catch (err) {
    logger.error('getCommercialDocumentFiles error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch files' } });
  }
};

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const contractDate = (req.body?.contract_date as string) || null;
    const monthFolder = commercialDocumentMonthFolder(contractDate);
    const dir = ensureUploadDir(path.join('commercial-documents', monthFolder));
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Final name is set after versioning lookup in uploadCommercialDocument; use temp unique name here.
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

export const commercialDocumentUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const docType = String((req as AuthRequest).body?.document_type || '').trim();
    const name = file.originalname.toLowerCase();
    const mime = file.mimetype || '';
    const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
    const isImage =
      docType === 'invoice_fp_full' &&
      (/^image\/(png|jpe?g|webp)$/i.test(mime) || /\.(png|jpe?g|webp)$/i.test(name));
    if (isPdf || isImage) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed (images allowed for Invoice + FP Full Receive only)'));
    }
  },
});

async function loadExistingFileNames(
  contractExtNo: string,
  documentType: string,
): Promise<string[]> {
  const types = isCommercialDocumentType(documentType)
    ? documentTypesForCategory(documentType)
    : [documentType];
  const result = await query(
    `SELECT file_name FROM commercial_document_files
     WHERE contract_ext_no = $1 AND document_type = ANY($2::text[])`,
    [contractExtNo, types],
  );
  return result.rows.map((r) => String(r.file_name || ''));
}

export const uploadCommercialDocument = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    const contractExtNo = String(req.body?.contract_ext_no || '').trim();
    const documentType = String(req.body?.document_type || '').trim();
    const buyerName = String(req.body?.buyer_name || req.body?.supplier_name || '').trim();
    const poNumber = String(req.body?.po_number || '').trim();

    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }
    if (!contractExtNo || !isCommercialDocumentType(documentType)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(400).json({ success: false, error: { message: 'Invalid contract_ext_no or document_type' } });
    }

    try {
      const scan = await scanFileWithClamdIfConfigured(file.path);
      if (!scan.skipped && !scan.clean) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        return res.status(400).json({ success: false, error: { message: 'File failed virus scan' } });
      }
    } catch (scanErr) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      logger.error('ClamAV scan error', scanErr);
      return res.status(503).json({ success: false, error: { message: 'Virus scanner unavailable' } });
    }

    const existingFileNames = await loadExistingFileNames(contractExtNo, documentType);
    const storedName = buildCommercialDocumentStoredName({
      buyerName,
      documentType,
      referenceNumber: poNumber || 'UNKNOWN',
      originalName: file.originalname,
      existingFileCount: existingFileNames.length,
    });

    const uploadDir = path.dirname(file.path);
    const finalAbsPath = path.join(uploadDir, storedName);
    if (finalAbsPath !== file.path) {
      if (fs.existsSync(finalAbsPath)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        return res.status(409).json({ success: false, error: { message: 'File name collision; please retry' } });
      }
      fs.renameSync(file.path, finalAbsPath);
    }

    const relativePath = toRelativeUploadPath(finalAbsPath);
    const userId = req.user?.id ?? null;
    const userName = req.user?.username || req.user?.email || 'Unknown';
    const actionType = existingFileNames.length > 0 ? 'EDIT' : 'ADD';

    const insertResult = await query(
      `INSERT INTO commercial_document_files
        (contract_ext_no, document_type, file_path, file_name, file_size, mime_type, checked, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)
       RETURNING *`,
      [contractExtNo, documentType, relativePath, storedName, file.size, file.mimetype, userId],
    );
    const savedFile = insertResult.rows[0];

    await query(
      `INSERT INTO commercial_document_history
        (contract_ext_no, document_type, action_type, file_path, file_name, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [contractExtNo, documentType, actionType, relativePath, storedName, userId, userName],
    );

    return res.json({
      success: true,
      message: actionType === 'ADD' ? 'Document uploaded' : 'New document version uploaded',
      data: { actionType, file_name: storedName, file_id: savedFile.id },
    });
  } catch (err) {
    logger.error('uploadCommercialDocument error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to upload document' } });
  }
};

async function streamCommercialFile(req: AuthRequest, res: Response, disposition: 'inline' | 'attachment') {
  try {
    const { id } = req.params;
    const result = await query(`SELECT * FROM commercial_document_files WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    const doc = result.rows[0];
    const absPath = resolveUploadAbsolutePath(doc.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: { message: 'File not found on server' } });
    }
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
    if (disposition === 'inline') {
      res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, doc.file_name);
  } catch (err) {
    logger.error('streamCommercialFile error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to retrieve document' } });
  }
}

export const viewCommercialDocument = (req: AuthRequest, res: Response) =>
  streamCommercialFile(req, res, 'inline');

export const downloadCommercialDocument = (req: AuthRequest, res: Response) =>
  streamCommercialFile(req, res, 'attachment');
