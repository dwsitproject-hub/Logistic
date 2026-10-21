import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { scanFileWithClamdIfConfigured } from '../services/clamScan.service';
import {
  allocateShipmentNasFilename,
  buildShipmentNasFileStem,
  ensureUploadDir,
  resolveUploadAbsolutePath,
  shipmentNasFileToken,
  shipmentStructuredDocKindFromType,
  toRelativeUploadPath,
} from '../utils/fileUpload';
import { AuthRequest } from '../middleware/auth';

export { ensureUploadDir };

export const listDocuments = async (req: Request, res: Response) => {
  try {
    const { contractId, shipmentId, truckingOperationId } = req.query;
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const params: any[] = [];
    let idx = 1;
    if (contractId) { sql += ` AND contract_id = $${idx++}`; params.push(contractId); }
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

    const stored = await applyShipmentNasFilename(req, file, document_type, shipment_id);
    if (stored.error) {
      return res.status(stored.status).json({ success: false, error: { message: stored.error } });
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

  const found = await query('SELECT operation_id FROM shipments WHERE id = $1', [shipment]);
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
  const dir = path.dirname(file.path);
  const filename = allocateShipmentNasFilename(dir, stem, ext);
  const nextPath = path.join(dir, filename);
  fs.renameSync(file.path, nextPath);
  return { fileName: filename, filePath: toRelativeUploadPath(nextPath) };
}

export const downloadDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM documents WHERE id = $1', [id]);
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


