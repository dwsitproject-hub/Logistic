import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest, userHasPermissionFlag } from '../middleware/auth';
import {
  buildCommercialDocumentStoredName,
  COMMERCIAL_DOCUMENT_TYPES,
  commercialDocumentTypeLabel,
  commercialDocumentUploadPermissionKey,
  commercialDocumentUploadRelativeDir,
  type CommercialDocumentType,
  documentTypesForCategory,
  isCommercialDocumentType,
} from '../utils/commercialDocumentsConstants';
import {
  buildCommercialDocumentsCompletenessByCreatorQuery,
  buildCommercialDocumentsCompletenessByPlantQuery,
  buildCommercialDocumentsListQuery,
  buildCommercialDocumentsSummaryQuery,
  commercialCompletenessPct,
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
import { logAudit } from '../middleware/audit';
import {
  isPoCreatorsAutoLoadEnabled,
  isPoCreatorsRunning,
  latestPoCreatorsRuns,
  listPoCreatorRuns,
  poCreatorsCron,
  runPoCreatorsAutoLoad,
  upsertPoCreators,
} from '../services/poCreators.service';

/**
 * One audit_logs row per upload, view, download, delete and Tanda Terima - the Audit trail page of the Commercial Documents app.
 * Never awaited by the caller and never throws: a failed audit write must not fail the document request.
 */
function auditCommercial(req: AuthRequest, action: string, entityId: string | undefined, details: Record<string, unknown>): void {
  void logAudit(req, action, 'COMMERCIAL_DOCUMENT', entityId, undefined, details).catch((error) =>
    logger.warn('commercial document audit failed', { action, error: error instanceof Error ? error.message : String(error) }),
  );
}

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

/** A SAP amount, kept NULL when SAP sent none (0 is a real value and stays 0). */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ADMIN, or can_create / can_edit on the type's upload permission for the user's role, level and transport type. */
export async function userMayUploadCommercialDocumentType(
  user: AuthRequest['user'] | undefined,
  documentType: CommercialDocumentType,
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const key = commercialDocumentUploadPermissionKey(documentType);
  try {
    return (
      (await userHasPermissionFlag(user.id, user.role, key, 'can_create')) ||
      (await userHasPermissionFlag(user.id, user.role, key, 'can_edit'))
    );
  } catch (err) {
    logger.error('commercial document upload permission lookup failed:', err);
    return false;
  }
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
    payoff_date: row.payoff_date,
    vessel_oa_budget: numberOrNull(row.vessel_oa_budget),
    vessel_oa_actual: numberOrNull(row.vessel_oa_actual),
    truck_oa_budget: numberOrNull(row.truck_oa_budget),
    truck_oa_actual: numberOrNull(row.truck_oa_actual),
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
    doc_draft_contract: row.doc_draft_contract,
    doc_contract: row.doc_contract,
    doc_addendum_contract: row.doc_addendum_contract,
    doc_berita_acara: row.doc_berita_acara,
    doc_bea_cukai: row.doc_bea_cukai,
    doc_sppb: row.doc_sppb,
    doc_sppd: row.doc_sppd,
    doc_delivery_order: row.doc_delivery_order,
    doc_invoice_fp_dp: row.doc_invoice_fp_dp,
    doc_invoice_fp_payoff: row.doc_invoice_fp_payoff,
    doc_invoice_fp_full: row.doc_invoice_fp_full,
  };
}

function parseDocumentStatus(value: string | undefined): 'checked' | 'unchecked' | null {
  if (value === 'checked' || value === 'unchecked') return value;
  return null;
}

function parseCompleteness(value: unknown): 'complete' | 'incomplete' | 'empty' | null {
  return value === 'complete' || value === 'incomplete' || value === 'empty' ? value : null;
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
      completeness: parseCompleteness(q.completeness),
      incoterm: parseQueryStringList(req.query.incoterm),
      product: parseQueryStringList(req.query.product),
      supplier: parseQueryStringList(req.query.supplier),
      plant: parseQueryStringList(req.query.plant),
      page,
      limit,
      sortKey: q.sortKey || null,
      sortDir: q.sortDir || null,
    };

    const { sql, countSql, values } = buildCommercialDocumentsListQuery(listParams);
    const [rowsResult, countResult] = await Promise.all([
      query(sql, values),
      query(countSql, values.slice(0, values.length - 2)),
    ]);

    const total = Number(countResult.rows[0]?.total ?? 0);
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
        filters: { dateFrom, dateTo },
      },
    });
  } catch (err) {
    logger.error('getCommercialDocuments error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch commercial documents' } });
  }
};

/**
 * Completeness by SAP creator (GET /api/commercial-documents/completeness-by-creator). The creator comes from the ME2N report loaded by an
 * administrator (commercial_po_creators); a PO the report does not know belongs to the row with an empty createdBy.
 */
export const getCommercialDocumentsCompletenessByCreator = async (req: AuthRequest, res: Response) => {
  try {
    const ytd = defaultYtdRange();
    const q = req.query as Record<string, string | undefined>;
    const dateFrom = q.dateFrom || ytd.dateFrom;
    const dateTo = q.dateTo || ytd.dateTo;
    const { sql, values } = buildCommercialDocumentsCompletenessByCreatorQuery({
      dateFrom,
      dateTo,
      plant: parseQueryStringList(req.query.plant),
    });
    const [result, loaded, runs] = await Promise.all([
      query(sql, values),
      query('SELECT COUNT(*)::int AS pos, COUNT(DISTINCT created_by)::int AS creators, MAX(loaded_at) AS loaded_at FROM commercial_po_creators'),
      latestPoCreatorsRuns().catch(() => ({ lastLoaded: null, lastRun: null })),
    ]);
    const creators = result.rows.map((row) => {
      const contractCount = Number(row.contract_count) || 0;
      const uploadedSlots = Number(row.uploaded_slots) || 0;
      const totalSlots = Number(row.total_slots) || 0;
      const byType: Record<string, number> = {};
      for (const type of COMMERCIAL_DOCUMENT_TYPES) byType[type] = Number(row[`uploaded_${type}`]) || 0;
      return {
        createdBy: String(row.created_by || ''),
        displayName: row.display_name ? String(row.display_name) : null,
        contractCount,
        uploadedSlots,
        totalSlots,
        missingSlots: Math.max(0, totalSlots - uploadedSlots),
        completenessPct: commercialCompletenessPct(uploadedSlots, totalSlots),
        completeCount: Number(row.complete_count) || 0,
        emptyCount: Number(row.empty_count) || 0,
        byType,
      };
    });
    return res.json({
      success: true,
      data: {
        creators,
        loaded: {
          pos: Number(loaded.rows[0]?.pos) || 0,
          creators: Number(loaded.rows[0]?.creators) || 0,
          loadedAt: loaded.rows[0]?.loaded_at ?? null,
        },
        auto: { enabled: isPoCreatorsAutoLoadEnabled(), lastLoaded: runs.lastLoaded, lastRun: runs.lastRun },
        filters: { dateFrom, dateTo },
      },
    });
  } catch (err) {
    logger.error('getCommercialDocumentsCompletenessByCreator error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch completeness by creator' } });
  }
};

const MAX_CREATOR_ROWS = 20000;

/**
 * Load PO -> creator pairs from the SAP ME2N report (POST /api/commercial-documents/po-creators, ADMIN). The browser reads the Excel file and
 * sends the pairs; a PO already known takes the new creator. Nothing else about a PO changes.
 */
export const importCommercialPoCreators = async (req: AuthRequest, res: Response) => {
  try {
    const body = (req.body || {}) as { rows?: unknown; source_file?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'rows is required' } });
    }
    if (body.rows.length > MAX_CREATOR_ROWS) {
      return res.status(400).json({ success: false, error: { message: `At most ${MAX_CREATOR_ROWS} rows per request` } });
    }
    const pos: string[] = [];
    const creators: string[] = [];
    for (const raw of body.rows as Array<Record<string, unknown>>) {
      const po = String(raw?.po_number ?? '').trim();
      const by = String(raw?.created_by ?? '').trim();
      if (!po || !by || po.length > 40 || by.length > 40) {
        return res.status(400).json({ success: false, error: { message: 'Every row needs a po_number and a created_by (up to 40 characters)' } });
      }
      pos.push(po);
      creators.push(by);
    }
    const sourceFile = String(body.source_file ?? '').trim().slice(0, 200) || null;
    await upsertPoCreators(
      pos.map((po_number, i) => ({ po_number, created_by: creators[i] })),
      sourceFile,
      req.user?.id ?? null,
    );
    auditCommercial(req, 'IMPORT_PO_CREATORS', undefined, { rows: pos.length, source_file: sourceFile });
    return res.json({ success: true, data: { loaded: pos.length } });
  } catch (err) {
    logger.error('importCommercialPoCreators error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load the creators' } });
  }
};

/**
 * The ME2N Report page (GET /api/commercial-documents/po-creators/status, ADMIN): whether the schedule is on and when, how much is loaded, and the
 * latest runs (the schedule's and the Sync button's), so a quiet morning and a problem do not look the same.
 */
export const getCommercialPoCreatorsStatus = async (_req: AuthRequest, res: Response) => {
  try {
    const [loaded, runs] = await Promise.all([
      query('SELECT COUNT(*)::int AS pos, COUNT(DISTINCT created_by)::int AS creators, MAX(loaded_at) AS loaded_at FROM commercial_po_creators'),
      listPoCreatorRuns(30),
    ]);
    return res.json({
      success: true,
      data: {
        running: isPoCreatorsRunning(),
        enabled: isPoCreatorsAutoLoadEnabled(),
        cron: poCreatorsCron(),
        loaded: {
          pos: Number(loaded.rows[0]?.pos) || 0,
          creators: Number(loaded.rows[0]?.creators) || 0,
          loadedAt: loaded.rows[0]?.loaded_at ?? null,
        },
        runs,
      },
    });
  } catch (err) {
    logger.error('getCommercialPoCreatorsStatus error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to read the ME2N status' } });
  }
};

/**
 * "Check now" (POST /api/commercial-documents/po-creators/sync, ADMIN): the same run as the schedule - look for the newest ME2N report in
 * the share's Original folder and load it if it is new. Answers with what happened (loaded, unchanged, no file, folder missing, failed).
 */
export const syncCommercialPoCreators = async (req: AuthRequest, res: Response) => {
  try {
    const result = await runPoCreatorsAutoLoad({ trigger: 'manual', startedBy: req.user?.id ?? null });
    auditCommercial(req, 'SYNC_PO_CREATORS', undefined, { outcome: result.outcome, file: result.fileName, rows: result.rows });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('syncCommercialPoCreators error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to check for the report' } });
  }
};

/*
 * No endpoint edits creator names. SAP gives an employee number (NIK); names will come from the PRC application's sync, which will write
 * commercial_creator_names (created_by -> display_name). The table and the join in the by-creator query are the place for it.
 */

export const getCommercialDocumentsSummary = async (req: AuthRequest, res: Response) => {
  try {
    const ytd = defaultYtdRange();
    const q = req.query as Record<string, string | undefined>;
    const dateFrom = q.dateFrom || ytd.dateFrom;
    const dateTo = q.dateTo || ytd.dateTo;
    const summaryQuery = buildCommercialDocumentsSummaryQuery({
      dateFrom,
      dateTo,
      search: q.search || null,
      incoterm: parseQueryStringList(req.query.incoterm),
      product: parseQueryStringList(req.query.product),
      supplier: parseQueryStringList(req.query.supplier),
      plant: parseQueryStringList(req.query.plant),
    });
    const result = await query(summaryQuery.sql, summaryQuery.values);
    const row = result.rows[0] ?? {};
    const totalCount = Number(row.total_contract_count ?? 0);

    // Percentages are derived on the client from these two counts, to one decimal.
    const card = (key: string) => ({ totalCount, uploadedCount: Number(row[key] ?? 0) });
    return res.json({
      success: true,
      data: {
        summary: {
          draft_contract: card('uploaded_draft_contract'),
          contract: card('uploaded_contract'),
          addendum_contract: card('uploaded_addendum_contract'),
          berita_acara: card('uploaded_berita_acara'),
          bea_cukai: card('uploaded_bea_cukai'),
          sppb: card('uploaded_sppb'),
          sppd: card('uploaded_sppd'),
          delivery_order: card('uploaded_delivery_order'),
          invoice_fp_dp: card('uploaded_invoice_fp_dp'),
          invoice_fp_payoff: card('uploaded_invoice_fp_payoff'),
          invoice_fp_full: card('uploaded_invoice_fp_full'),
        },
        // All eleven / none / anything short of eleven - the list's completeness filter returns the same rows.
        contracts: {
          totalCount,
          completeCount: Number(row.complete_contract_count ?? 0),
          incompleteCount: totalCount - Number(row.complete_contract_count ?? 0),
          emptyCount: Number(row.empty_contract_count ?? 0),
        },
        filters: { dateFrom, dateTo },
      },
    });
  } catch (err) {
    logger.error('getCommercialDocumentsSummary error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch commercial documents summary' } });
  }
};

export const getCommercialDocumentsCompletenessByPlant = async (req: AuthRequest, res: Response) => {
  try {
    const ytd = defaultYtdRange();
    const q = req.query as Record<string, string | undefined>;
    const dateFrom = q.dateFrom || ytd.dateFrom;
    const dateTo = q.dateTo || ytd.dateTo;
    const { sql, values } = buildCommercialDocumentsCompletenessByPlantQuery({
      dateFrom,
      dateTo,
      plant: parseQueryStringList(req.query.plant),
    });
    const result = await query(sql, values);
    const plants = result.rows.map((row) => {
      const contractCount = Number(row.contract_count) || 0;
      const uploadedSlots = Number(row.uploaded_slots) || 0;
      const totalSlots = Number(row.total_slots) || 0;
      const byType: Record<string, number> = {};
      for (const type of COMMERCIAL_DOCUMENT_TYPES) byType[type] = Number(row[`uploaded_${type}`]) || 0;
      return {
        plant: String(row.plant_site || 'Unassigned'),
        contractCount,
        uploadedSlots,
        totalSlots,
        missingSlots: Math.max(0, totalSlots - uploadedSlots),
        completenessPct: commercialCompletenessPct(uploadedSlots, totalSlots),
        completeCount: Number(row.complete_count) || 0,
        emptyCount: Number(row.empty_count) || 0,
        byType,
      };
    });
    const contractCount = plants.reduce((sum, row) => sum + row.contractCount, 0);
    const uploadedSlots = plants.reduce((sum, row) => sum + row.uploadedSlots, 0);
    const totalSlots = plants.reduce((sum, row) => sum + row.totalSlots, 0);
    return res.json({
      success: true,
      data: {
        plants,
        totals: {
          contractCount,
          uploadedSlots,
          totalSlots,
          missingSlots: Math.max(0, totalSlots - uploadedSlots),
          completenessPct: commercialCompletenessPct(uploadedSlots, totalSlots),
          completeCount: plants.reduce((sum, row) => sum + row.completeCount, 0),
          emptyCount: plants.reduce((sum, row) => sum + row.emptyCount, 0),
        },
        filters: { dateFrom, dateTo },
      },
    });
  } catch (err) {
    logger.error('getCommercialDocumentsCompletenessByPlant error:', err);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch commercial document completeness' },
    });
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
    const poNumber = resolveCommercialDocumentPoKey(
      (req as AuthRequest).body?.po_number,
      (req as AuthRequest).body?.contract_id,
    );
    const dir = ensureUploadDir(commercialDocumentUploadRelativeDir(poNumber));
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

async function loadExistingFileRows(
  poNumber: string,
  documentType: string,
): Promise<Array<{ id: string; file_name: string; file_path: string }>> {
  const types = isCommercialDocumentType(documentType)
    ? documentTypesForCategory(documentType)
    : [documentType];
  const result = await query(
    `SELECT id, file_name, file_path FROM commercial_document_files
     WHERE NULLIF(TRIM(po_number), '') = $1 AND document_type = ANY($2::text[])`,
    [poNumber, types],
  );
  return result.rows.map((r) => ({
    id: String(r.id),
    file_name: String(r.file_name || ''),
    file_path: String(r.file_path || ''),
  }));
}

function unlinkStoredUpload(filePath: string): void {
  if (!filePath) return;
  try {
    const abs = resolveUploadAbsolutePath(filePath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore missing files */
  }
}

async function replacePreviousContractFiles(poNumber: string): Promise<number> {
  const previous = await loadExistingFileRows(poNumber, 'contract');
  if (previous.length === 0) return 0;
  for (const row of previous) {
    unlinkStoredUpload(row.file_path);
  }
  await query(`DELETE FROM commercial_document_files WHERE id = ANY($1::uuid[])`, [
    previous.map((row) => row.id),
  ]);
  return previous.length;
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
    /*
     * Per document type, from the role's permissions (Role Management > data.commercial_documents.upload.<type>), checked here and not in the route
     * because the type travels in the multipart body that multer has only just read. The temp file multer wrote is removed on refusal.
     */
    if (!(await userMayUploadCommercialDocumentType(req.user, documentType))) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(403).json({
        success: false,
        error: {
          message: `Your role is not allowed to upload ${commercialDocumentTypeLabel(documentType)}. Ask an admin to grant it in Role Management.`,
        },
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

    let existingFileCount = 0;
    let replacedContractCount = 0;
    if (documentType === 'contract') {
      replacedContractCount = await replacePreviousContractFiles(poNumber);
    } else {
      existingFileCount = (await loadExistingFileRows(poNumber, documentType)).length;
    }

    // The version suffix follows the number of files on the record, so deleting an earlier version frees a number that a later version still
    // holds on disk (3 versions, delete the first: the next upload would be "(3)" again). Walk up to the first name no file has.
    const uploadDir = path.dirname(file.path);
    let storedName = '';
    let finalAbsPath = '';
    for (let bump = 0; bump < 50; bump += 1) {
      storedName = buildCommercialDocumentStoredName({
        buyerName,
        documentType,
        referenceNumber: poNumber || 'UNKNOWN',
        originalName: file.originalname,
        existingFileCount: existingFileCount + bump,
      });
      finalAbsPath = path.join(uploadDir, storedName);
      if (finalAbsPath === file.path || !fs.existsSync(finalAbsPath)) break;
      if (bump === 49) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        return res.status(409).json({ success: false, error: { message: 'File name collision; please retry' } });
      }
    }
    if (finalAbsPath !== file.path) {
      fs.renameSync(file.path, finalAbsPath);
    }

    const relativePath = toRelativeUploadPath(finalAbsPath);
    const userId = req.user?.id ?? null;
    const userName = req.user?.username || req.user?.email || 'Unknown';
    const actionType = documentType === 'contract'
      ? replacedContractCount > 0 ? 'EDIT' : 'ADD'
      : existingFileCount > 0 ? 'EDIT' : 'ADD';

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

    auditCommercial(req, 'UPLOAD', savedFile.id, {
      po_number: poNumber, contract_ext_no: contractExtNo, document_type: documentType, file_name: storedName, action_type: actionType,
    });
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
    auditCommercial(req, disposition === 'inline' ? 'VIEW' : 'DOWNLOAD', doc.id, {
      po_number: doc.po_number, contract_ext_no: doc.contract_ext_no, document_type: doc.document_type, file_name: doc.file_name,
    });
    // A stored mime_type that is not a PDF type (octet-stream from an import, a missing value) must not turn a .pdf into a
    // download in the browser's viewer: the file name decides, the stored type is only used for other files.
    const isPdfName = /\.pdf$/i.test(String(doc.file_name || ''));
    res.setHeader('Content-Type', isPdfName ? 'application/pdf' : doc.mime_type || 'application/pdf');
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove one uploaded document version (route: data.commercial_documents can_delete, so a role scoped to Dept Head decides who may).
 * The row goes and a DELETE entry joins the history in one statement. The file stays in the upload store: history keeps its path, so a
 * wrong delete can be recovered by hand, and its stored name is never reused (see the name walk in uploadCommercialDocument).
 */
export const deleteCommercialDocument = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid document id' } });
    }
    const userId = req.user?.id ?? null;
    const userName = req.user?.username || req.user?.email || 'Unknown';
    const result = await query(
      `WITH removed AS (
         DELETE FROM commercial_document_files WHERE id = $1::uuid
         RETURNING contract_ext_no, po_number, document_type, file_path, file_name
       )
       INSERT INTO commercial_document_history
         (contract_ext_no, po_number, document_type, action_type, file_path, file_name, user_id, user_name)
       SELECT contract_ext_no, po_number, document_type, 'DELETE', file_path, file_name, $2::uuid, $3 FROM removed
       RETURNING document_type, file_name, po_number, contract_ext_no`,
      [id, userId, userName],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    auditCommercial(req, 'DELETE', id, result.rows[0]);
    return res.json({ success: true, message: 'Document deleted', data: result.rows[0] });
  } catch (err) {
    logger.error('deleteCommercialDocument error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to delete document' } });
  }
};

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
    auditCommercial(req, 'DOWNLOAD_TANDA_TERIMA', undefined, { contract_ext_nos: contractExtNos, send_date: sendDateIso });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    logger.error('downloadTandaTerima error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to generate Tanda Terima PDF' } });
  }
};
