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
import {
  buildTandaTerimaPdf,
  tandaTerimaDownloadFilename,
  type TandaTerimaContractLine,
} from '../services/tandaTerimaPdf.service';
import { buildTandaTerimaContractsByExtNoSql } from '../utils/tandaTerimaQuerySql';

function defaultYtdRange(): { dateFrom: string; dateTo: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-${m}-${day}` };
}

/** Prefer PO; fall back to contract_id for rows without PO. */
function resolveCommercialDocumentPoKey(rawPo: unknown, fallback?: unknown): string {
  const po = String(rawPo ?? '').trim();
  if (po) return po;
  return String(fallback ?? '').trim();
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

function parseQueryStringList(value: unknown): string[] {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((item) => String(item).trim()).filter(Boolean);
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
      plant: parseQueryStringList(req.query.plant),
      page,
      limit,
    };

    const includeSummary = String(q.includeSummary ?? 'true').toLowerCase() !== 'false';

    const { sql, countSql, values } = buildCommercialDocumentsListQuery(listParams);
    const summaryQuery = includeSummary
      ? buildCommercialDocumentsSummaryQuery({ dateFrom, dateTo })
      : null;
    const [rowsResult, countResult, summaryResult] = await Promise.all([
      query(sql, values),
      query(countSql, values.slice(0, values.length - 2)),
      summaryQuery
        ? query(summaryQuery.sql, summaryQuery.values)
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
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
        ...(includeSummary
          ? {
              summary: {
                contract: buildCard('checked_contract'),
                addendum_contract: buildCard('checked_addendum_contract'),
                invoice_fp_dp: buildCard('checked_invoice_fp_dp'),
                invoice_fp_payoff: buildCard('checked_invoice_fp_payoff'),
                invoice_fp_full: buildCard('checked_invoice_fp_full'),
              },
            }
          : {}),
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
    const poNumber = resolveCommercialDocumentPoKey(req.params.poNumber);
    const contractExtNo = String(req.query.contract_ext_no || '').trim();
    if (!poNumber) {
      return res.status(400).json({ success: false, error: { message: 'po_number is required' } });
    }
    const result = await query(
      `SELECT id, contract_ext_no, po_number, document_type, action_type, file_name, user_name, created_at
       FROM commercial_document_history
       WHERE NULLIF(TRIM(po_number), '') = $1
          OR (
            NULLIF(TRIM(po_number), '') IS NULL
            AND $2 <> ''
            AND TRIM(contract_ext_no) = $2
          )
       ORDER BY created_at DESC
       LIMIT 200`,
      [poNumber, contractExtNo],
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
    const poNumber = resolveCommercialDocumentPoKey(req.params.poNumber);
    const contractExtNo = String(req.query.contract_ext_no || '').trim();
    if (!poNumber) {
      return res.status(400).json({ success: false, error: { message: 'po_number is required' } });
    }
    const result = await query(
      `SELECT id, contract_ext_no, po_number, document_type, file_name, file_path, checked, created_at, updated_at
       FROM commercial_document_files
       WHERE NULLIF(TRIM(po_number), '') = $1
          OR (
            NULLIF(TRIM(po_number), '') IS NULL
            AND $2 <> ''
            AND TRIM(contract_ext_no) = $2
          )
       ORDER BY document_type ASC, created_at ASC`,
      [poNumber, contractExtNo],
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

async function loadExistingFileNames(poNumber: string, documentType: string): Promise<string[]> {
  const types = isCommercialDocumentType(documentType)
    ? documentTypesForCategory(documentType)
    : [documentType];
  const result = await query(
    `SELECT file_name FROM commercial_document_files
     WHERE NULLIF(TRIM(po_number), '') = $1 AND document_type = ANY($2::text[])`,
    [poNumber, types],
  );
  return result.rows.map((r) => String(r.file_name || ''));
}

export const uploadCommercialDocument = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    const contractExtNo = String(req.body?.contract_ext_no || '').trim();
    const documentType = String(req.body?.document_type || '').trim();
    const buyerName = String(req.body?.buyer_name || req.body?.supplier_name || '').trim();
    const poNumber = resolveCommercialDocumentPoKey(
      req.body?.po_number,
      req.body?.contract_id,
    );

    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }
    if (!poNumber || !isCommercialDocumentType(documentType)) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid po_number or document_type' },
      });
    }
    if (!contractExtNo) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(400).json({
        success: false,
        error: { message: 'contract_ext_no is required for audit trail' },
      });
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

    const existingFileNames = await loadExistingFileNames(poNumber, documentType);
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
        (contract_ext_no, po_number, document_type, file_path, file_name, file_size, mime_type, checked, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
       RETURNING *`,
      [contractExtNo, poNumber, documentType, relativePath, storedName, file.size, file.mimetype, userId],
    );
    const savedFile = insertResult.rows[0];

    await query(
      `INSERT INTO commercial_document_history
        (contract_ext_no, po_number, document_type, action_type, file_path, file_name, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [contractExtNo, poNumber, documentType, actionType, relativePath, storedName, userId, userName],
    );

    return res.json({
      success: true,
      message: actionType === 'ADD' ? 'Document uploaded' : 'New document version uploaded',
      data: { actionType, file_name: storedName, file_id: savedFile.id, po_number: poNumber },
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

function parseIsoSendDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

export const downloadTandaTerima = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as { contractExtNos?: unknown; sendDate?: unknown };
    const contractExtNos = Array.isArray(body.contractExtNos)
      ? [...new Set(body.contractExtNos.map((v) => String(v ?? '').trim()).filter(Boolean))]
      : [];
    const sendDateIso = parseIsoSendDate(body.sendDate);

    if (contractExtNos.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Select at least one contract' },
      });
    }
    if (!sendDateIso) {
      return res.status(400).json({
        success: false,
        error: { message: 'Send Date is required (YYYY-MM-DD)' },
      });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }

    const [contractsRes, userRes] = await Promise.all([
      query(buildTandaTerimaContractsByExtNoSql(), [contractExtNos]),
      query(`SELECT email, full_name FROM users WHERE id = $1`, [userId]),
    ]);

    const found = contractsRes.rows as { contract_ext_no: string; supplier: string | null }[];
    if (found.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'No matching contracts found for the selected contract ext numbers' },
      });
    }

    const foundSet = new Set(found.map((r) => r.contract_ext_no));
    const missing = contractExtNos.filter((ext) => !foundSet.has(ext));
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Contract ext no not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
        },
      });
    }

    const orderMap = new Map(contractExtNos.map((ext, i) => [ext, i]));
    const lines: TandaTerimaContractLine[] = [...found].sort(
      (a, b) => (orderMap.get(a.contract_ext_no) ?? 0) - (orderMap.get(b.contract_ext_no) ?? 0),
    ).map((r) => ({
      contractExtNo: r.contract_ext_no,
      supplier: r.supplier,
    }));

    const userRow = userRes.rows[0] as { email?: string; full_name?: string } | undefined;
    const pdfBytes = await buildTandaTerimaPdf({
      lines,
      sendDateIso,
      senderEmail: String(userRow?.email ?? req.user?.email ?? '').trim(),
      senderFullName: String(userRow?.full_name ?? req.user?.username ?? '').trim(),
    });

    const filename = tandaTerimaDownloadFilename(sendDateIso);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    logger.error('downloadTandaTerima error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to generate Tanda Terima PDF' } });
  }
};
