import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { scanFileWithClamdIfConfigured } from '../services/clamScan.service';
import {
  allocateShipmentNasFilename,
  buildShipmentDocumentUploadSubdir,
  buildShipmentNasFileStem,
  buildTruckingDocumentUploadSubdir,
  ensureUploadDir,
  resolveUploadAbsolutePath,
  shipmentNasFileToken,
  shipmentStructuredDocKindFromType,
  toRelativeUploadPath,
  type ShipmentStructuredDocKind,
} from '../utils/fileUpload';
import { AuthRequest } from '../middleware/auth';
import { AuditService } from '../services/audit.service';
import { resolveShipmentEditContext } from '../services/shipmentEditContext.service';
import { SELECT_CONTRACT_TRUCKING_FOLDER_SQL, SELECT_SHIPMENT_FOLDER_SQL, SELECT_TRUCKING_FOLDER_SQL } from '../utils/documentFolders';

export { ensureUploadDir };

export const listDocuments = async (req: Request, res: Response) => {
  try {
    const { contractId, shipmentId, truckingOperationId } = req.query;
    let sql = 'SELECT * FROM documents WHERE deleted_at IS NULL';
    const params: any[] = [];
    let idx = 1;
    // A file uploaded from the Trucking page on an operation row carries trucking_operation_id and no contract_id, so a bare contract_id test never found it: the
    // Contract Details modal read "No documents uploaded" for a contract whose operation had one. The contract's own documents are those filed on it AND those filed
    // on its trucking operations (the Trucking page already merges the two the other way round).
    if (contractId) {
      sql += ` AND (contract_id = $${idx} OR trucking_operation_id IN (SELECT t.id FROM trucking_operations t WHERE t.contract_id = $${idx}))`;
      params.push(contractId);
      idx += 1;
    }
    if (shipmentId) { sql += ` AND shipment_id = $${idx++}`; params.push(shipmentId); }
    if (truckingOperationId) { sql += ` AND trucking_operation_id = $${idx++}`; params.push(truckingOperationId); }
    sql += ' ORDER BY upload_date DESC';

    const result = await query(sql, params);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List documents error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch documents' } });
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESENCE_MAX_IDS = 100;

function presenceIds(raw: unknown): string[] {
  return Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s)),
    ),
  ).slice(0, PRESENCE_MAX_IDS);
}

/**
 * GET /documents/presence?shipmentIds=a,b&contractIds=c,d&truckingOperationIds=e - which of these shipments / contracts / trucking operations have at least one document. The Shipments page asks for the rows it shows
 * and turns the Docs button off for the ones that have none, so nobody opens an empty "No documents uploaded" dialog. A contract's documents are counted the way
 * listDocuments counts them for the Documents dialog (its own file or one filed on its trucking operations), so the button and the dialog never disagree.
 */
export const documentPresence = async (req: Request, res: Response) => {
  try {
    const shipmentIds = presenceIds(req.query.shipmentIds);
    const contractIds = presenceIds(req.query.contractIds);
    const truckingOperationIds = presenceIds(req.query.truckingOperationIds);
    const withDocs = { shipmentIds: [] as string[], contractIds: [] as string[], truckingOperationIds: [] as string[] };
    if (shipmentIds.length > 0) {
      const r = await query(
        `SELECT DISTINCT d.shipment_id::text AS id
           FROM documents d
          WHERE d.deleted_at IS NULL AND d.shipment_id = ANY($1::uuid[])`,
        [shipmentIds],
      );
      withDocs.shipmentIds = r.rows.map((row: { id: string }) => row.id);
    }
    if (contractIds.length > 0) {
      const r = await query(
        `SELECT c.id::text AS id
           FROM unnest($1::uuid[]) AS c(id)
          WHERE EXISTS (
            SELECT 1 FROM documents d
             WHERE d.deleted_at IS NULL
               AND (d.contract_id = c.id
                    OR d.trucking_operation_id IN (SELECT t.id FROM trucking_operations t WHERE t.contract_id = c.id))
          )`,
        [contractIds],
      );
      withDocs.contractIds = r.rows.map((row: { id: string }) => row.id);
    }
    if (truckingOperationIds.length > 0) {
      const r = await query(
        `SELECT DISTINCT d.trucking_operation_id::text AS id
           FROM documents d
          WHERE d.deleted_at IS NULL AND d.trucking_operation_id = ANY($1::uuid[])`,
        [truckingOperationIds],
      );
      withDocs.truckingOperationIds = r.rows.map((row: { id: string }) => row.id);
    }
    return res.json({ success: true, data: withDocs });
  } catch (error) {
    logger.error('Document presence error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to check documents' } });
  }
};

export const uploadDocumentHandler = async (req: Request, res: Response) => {
  try {
    // Multer attaches file and fields
    const file = (req as any).file as Express.Multer.File;
    const { document_type, contract_id, shipment_id, payment_id, trucking_operation_id, description } = req.body;

    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }

    try {
      const scan = await scanFileWithClamdIfConfigured(file.path);
      if (!scan.skipped && !scan.clean) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        return res.status(400).json({
          success: false,
          error: { message: 'File failed virus scan', detail: scan.reason },
        });
      }
    } catch (scanErr) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      logger.error('ClamAV scan error', scanErr);
      return res.status(503).json({
        success: false,
        error: { message: 'Virus scanner unavailable; upload rejected' },
      });
    }

    let stored = await applyShipmentNasFilename(req, file, document_type, shipment_id);
    if (stored.error) {
      return res.status(stored.status).json({ success: false, error: { message: stored.error } });
    }
    // From the Trucking page: documents/trucking/<operation id or contract number> on the upload root (the Synology share in production).
    if (!shipment_id && (trucking_operation_id || String(req.body?.upload_context ?? '').trim() === 'trucking')) {
      const moved = await moveToTruckingFolder(file.path, { truckingOperationId: trucking_operation_id, contractId: contract_id });
      if (moved) stored = { fileName: stored.fileName as string, filePath: toRelativeUploadPath(moved) };
    }

    const insert = await query(
      `INSERT INTO documents (document_type, file_name, file_path, file_size, mime_type, contract_id, shipment_id, payment_id, trucking_operation_id, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        document_type || 'OTHER',
        stored.fileName,
        stored.filePath,
        file.size,
        file.mimetype,
        contract_id || null,
        shipment_id || null,
        payment_id || null,
        trucking_operation_id || null,
        description || null,
      ]
    );

    return res.json({ success: true, data: insert.rows[0], message: 'Document uploaded successfully' });
  } catch (error: unknown) {
    logger.error('Upload document error:', error);
    const pgCode = (error as { code?: string })?.code;
    const pgDetail = (error as { detail?: string })?.detail;
    if (pgCode === '23514') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid document type for this upload',
          detail: pgDetail,
        },
      });
    }
    return res.status(500).json({ success: false, error: { message: 'Failed to upload document' } });
  }
};

/**
 * Moves an uploaded file into `documents/trucking/<subject>` under the upload root: the PO number of the trucking operation's contract (its operation id when that has
 * no PO, then the contract number), or, for a contract row with no operation, the contract's PO number (then its number). Returns the new absolute path, or null when the file stays where multer wrote it (no subject found, or the move failed): an upload
 * must not fail because of where its file is filed, and the stored path always says where it really is.
 */
export async function moveToTruckingFolder(
  currentAbsPath: string,
  ref: { truckingOperationId?: unknown; contractId?: unknown },
): Promise<string | null> {
  try {
    const operationUuid = String(ref.truckingOperationId ?? '').trim();
    const contractUuid = String(ref.contractId ?? '').trim();
    let subject = '';
    if (operationUuid) {
      const r = await query(SELECT_TRUCKING_FOLDER_SQL, [operationUuid]);
      subject = String(r.rows[0]?.subject ?? '').trim();
    }
    if (!subject && contractUuid) {
      const r = await query(SELECT_CONTRACT_TRUCKING_FOLDER_SQL, [contractUuid]);
      subject = String(r.rows[0]?.subject ?? '').trim();
    }
    if (!subject) return null;
    const dir = ensureUploadDir(buildTruckingDocumentUploadSubdir(subject));
    const target = path.join(dir, path.basename(currentAbsPath));
    if (path.resolve(target) === path.resolve(currentAbsPath)) return target;
    try {
      fs.renameSync(currentAbsPath, target);
    } catch (err) {
      // A rename cannot cross file systems (EXDEV); copy then remove.
      if ((err as { code?: string })?.code !== 'EXDEV') throw err;
      fs.copyFileSync(currentAbsPath, target);
      fs.unlinkSync(currentAbsPath);
    }
    return target;
  } catch (err) {
    logger.warn('Trucking document stays in the upload root (could not file it under documents/trucking)', { error: (err as Error)?.message });
    return null;
  }
}

function uploaderLabel(req: Request): string {
  const user = (req as AuthRequest).user;
  const username = String(user?.username ?? '').trim();
  if (username) return username.split('@')[0];
  const email = String(user?.email ?? '').trim();
  if (email) return email.split('@')[0];
  return 'user';
}

function discardUploadedFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Contract, SI, and BL are renamed on disk to
 * operation_id-ctr|si|bl-ddmmyy-username.pdf before the row is stored.
 * Other document types keep the name multer already wrote.
 */
async function applyShipmentNasFilename(
  req: Request,
  file: Express.Multer.File,
  documentType: string | undefined,
  shipmentId: string | undefined,
): Promise<{ fileName: string; filePath: string; error?: undefined; status?: undefined } | { error: string; status: number; fileName?: undefined; filePath?: undefined }> {
  const kind = shipmentStructuredDocKindFromType(String(documentType ?? ''));
  const token = kind ? shipmentNasFileToken(kind) : null;
  const shipment = String(shipmentId ?? '').trim();
  if (!token || !shipment) {
    return { fileName: file.originalname, filePath: toRelativeUploadPath(file.path) };
  }

  const found = await query(SELECT_SHIPMENT_FOLDER_SQL, [shipment]);
  if (found.rows.length === 0) {
    discardUploadedFile(file.path);
    return { error: 'Shipment not found', status: 404 };
  }
  const operationId = String(found.rows[0]?.operation_id ?? '').trim();
  if (!operationId) {
    discardUploadedFile(file.path);
    return { error: 'This shipment has no operation id, so the file cannot be named', status: 400 };
  }

  const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
  const stem = buildShipmentNasFileStem({
    operationId,
    token,
    uploadedBy: uploaderLabel(req),
  });
  // The folder is chosen HERE, from the parsed body, and not left to multer's destination callback: every client appends `file` BEFORE document_type / shipment_id,
  // so at destination time the body was still empty and the file landed in the upload root (found 2026-10-29: six renamed Contract/SI/BL files sitting loose in the
  // root of the Synology share). The rename below moves it into documents/shipment/<kind>/<STO number, else operation id>/ whichever folder multer wrote it to
  // (utils/documentFolders.ts); a shipment whose key cannot be read keeps its id as the folder name.
  const folderSubject = String(found.rows[0]?.folder_subject ?? '').trim() || shipment;
  const dir = ensureUploadDir(buildShipmentDocumentUploadSubdir(folderSubject, kind as ShipmentStructuredDocKind));
  const filename = allocateShipmentNasFilename(dir, stem, ext);
  const nextPath = path.join(dir, filename);
  fs.renameSync(file.path, nextPath);
  return { fileName: filename, filePath: toRelativeUploadPath(nextPath) };
}

/** The type a browser can show inline (PDF, PNG, JPEG): the stored mime type first, then the extension. Anything else is null and is downloaded instead. */
export function inlineMimeType(fileName: string | null | undefined, mimeType: string | null | undefined): string | null {
  const mime = String(mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf' || mime === 'image/png' || mime === 'image/jpeg') return mime;
  const name = String(fileName ?? '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

/**
 * The origins allowed to show a document in a frame or to read it from a browser: JPS's own (JPS_API_BASE_URL) and DOCUMENT_VIEW_ORIGINS (comma-separated; the JPS web
 * application when it is not on the same origin as its API). Empty strings and anything that is not an http(s) origin are dropped.
 */
export function documentViewOrigins(env: NodeJS.ProcessEnv = process.env, jpsBase: string = ''): string[] {
  const out = new Set<string>();
  for (const raw of [jpsBase, ...String(env.DOCUMENT_VIEW_ORIGINS ?? '').split(',')]) {
    const t = String(raw ?? '').trim();
    if (!/^https?:\/\//i.test(t)) continue;
    try {
      out.add(new URL(t).origin);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/**
 * Opens a document to be VIEWED: `Content-Disposition: inline` with its real type, where /download answers `attachment` (the browser saves the file). Open like /download, for
 * the same reason (JPS operators may have no KLIP account; ids are uuids; see document.routes.ts). JPS shows the three shipment documents (Contract, SI, BL) KLIP sends it
 * by these links, so this route also lets JPS's own origin embed the file: the response carries `frame-ancestors 'self' <JPS origins>` and no X-Frame-Options (helmet's default
 * and the nginx block both say SAMEORIGIN, which would refuse a frame from another origin), CORP cross-origin, and CORS for those origins. Only these headers change, and only here.
 * A type a browser cannot show is sent as a download, as /download does.
 */
export const viewDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    const doc = result.rows[0];
    const absPath = resolveUploadAbsolutePath(doc.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: { message: 'File not found on server' } });
    }
    const type = inlineMimeType(doc.file_name, doc.mime_type);
    if (!type) return res.download(absPath, doc.file_name);

    let jpsBase = '';
    try {
      jpsBase = (await import('../jps/config')).jpsBaseUrl();
    } catch {
      /* JPS not configured: only DOCUMENT_VIEW_ORIGINS counts */
    }
    const origins = documentViewOrigins(process.env, jpsBase);
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self'${origins.length ? ' ' + origins.join(' ') : ''}`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const requestOrigin = String(req.headers?.origin ?? '').replace(/\/$/, '');
    if (requestOrigin && origins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(String(doc.file_name ?? 'document'))}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // sendFile answers Range requests, which a PDF viewer uses; its own type guess is overridden by the header set above.
    return res.sendFile(absPath, { headers: { 'Content-Type': type } });
  } catch (error) {
    logger.error('View document error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to open document' } });
  }
};

/** The shipment documents a user may delete from Edit Shipment. SLD / SDD and every other kind are not part of that feature. */
export const DELETABLE_SHIPMENT_DOC_TYPES = ['CONTRACT', 'SI', 'BL'] as const;
export const DELETE_DOCUMENT_CODES = { SENT_TO_JPS: 'SENT_TO_JPS' } as const;

/**
 * DELETE /documents/:id - delete an uploaded Contract / SI / BL of a shipment (Edit Shipment). A SOFT delete: the row is hidden (deleted_at, deleted_by,
 * deleted_reason) and the file stays on the share, so a mistake can be undone. Every read path filters deleted rows out. The delete is written to the audit
 * log against the document, which the shipment's Activity History lists next to the upload.
 *
 * A reason is required. When the shipment's operation was already sent to JPS the instruction carries a link to this file, and that link stops working: the
 * first call answers 409 SENT_TO_JPS and the caller repeats it with `confirmJps: true` once the user has been told.
 */
export const deleteShipmentDocument = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ success: false, error: { message: 'A reason for deleting the document is required' } });
    if (reason.length > 500) return res.status(400).json({ success: false, error: { message: 'The reason is too long (500 characters at most)' } });

    const found = await query('SELECT * FROM documents WHERE id = $1::uuid AND deleted_at IS NULL', [id]);
    const doc = found.rows[0] as
      | { id: string; document_type: string; file_name: string; shipment_id: string | null; contract_id: string | null }
      | undefined;
    if (!doc) return res.status(404).json({ success: false, error: { message: 'Document not found' } });

    const type = String(doc.document_type ?? '').trim().toUpperCase();
    if (!doc.shipment_id || !(DELETABLE_SHIPMENT_DOC_TYPES as readonly string[]).includes(type)) {
      return res.status(403).json({ success: false, error: { message: 'Only the Contract, SI and BL documents of a shipment can be deleted here' } });
    }

    // Sent to JPS: its instruction links to this file.
    const context = await resolveShipmentEditContext(doc.shipment_id);
    const shipmentRow = await query('SELECT operation_id FROM shipments WHERE id = $1::uuid', [doc.shipment_id]);
    const keys = [
      ...new Set([String(context?.lookup_key ?? '').trim(), String(shipmentRow.rows[0]?.operation_id ?? '').trim()].filter(Boolean)),
    ];
    const jps =
      keys.length === 0
        ? { rows: [] as unknown[] }
        : await query(
            'SELECT 1 FROM jps_shipping_instructions WHERE sto_key = ANY($1::text[]) AND (jps_id IS NOT NULL OR submitted_at IS NOT NULL) LIMIT 1',
            [keys],
          );
    const jpsConfirmed = req.body?.confirmJps === true;
    if (jps.rows.length > 0 && !jpsConfirmed) {
      return res.status(409).json({
        success: false,
        error: {
          code: DELETE_DOCUMENT_CODES.SENT_TO_JPS,
          message: 'This shipment was already sent to JPS, and the instruction links to this file. After the delete that link no longer opens.',
        },
      });
    }

    const updated = await query(
      'UPDATE documents SET deleted_at = now(), deleted_by = $2::uuid, deleted_reason = $3 WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id',
      [id, userId, reason],
    );
    if (updated.rows.length === 0) return res.status(404).json({ success: false, error: { message: 'Document not found' } });

    await AuditService.log({
      userId,
      action: 'DELETE',
      entityType: 'DOCUMENT',
      entityId: id,
      beforeData: { file_name: doc.file_name, document_type: type, shipment_id: doc.shipment_id },
      afterData: { reason, sentToJps: jps.rows.length > 0 },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    return res.json({ success: true, message: 'Document deleted', data: { id } });
  } catch (error) {
    logger.error('Delete document error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to delete the document' } });
  }
};

export const downloadDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    const doc = result.rows[0];
    const absPath = resolveUploadAbsolutePath(doc.file_path);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, error: { message: 'File not found on server' } });
    }
    // Use Express helper to ensure a response is always sent
    return res.download(absPath, doc.file_name);
  } catch (error) {
    logger.error('Download document error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to download document' } });
  }
};


