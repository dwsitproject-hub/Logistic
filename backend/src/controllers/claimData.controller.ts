import { Response } from 'express';
import * as XLSX from 'xlsx';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { parseClaimDataWorkbook, type ClaimDataKind } from '../utils/claimDataWorkbook';
import { importClaimData } from '../services/claimData.service';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Upload one Claim Data file: OSCLAIM (kind=os, replaces the outstanding snapshot) or REALCLAIM
 * (kind=real, upserted per CR number). One file carries MUTU and SUSUT claims; they are split by
 * TYPE OF CLAIM into Quality Claim and Shortage Claim.
 */
export const uploadClaimData = async (req: AuthRequest, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  try {
    const kindRaw = String((req.body as any)?.kind ?? '').trim().toLowerCase();
    const kind: ClaimDataKind | null = kindRaw === 'os' || kindRaw === 'real' ? kindRaw : null;
    if (!file) return res.status(400).json({ success: false, error: { message: 'File is required' } });
    if (!kind) {
      return res.status(400).json({ success: false, error: { message: 'kind must be "os" (outstanding) or "real" (realised)' } });
    }
    const asOfRaw = String((req.body as any)?.dataAsOf ?? '').trim();
    if (asOfRaw && !ISO_DATE_RE.test(asOfRaw)) {
      return res.status(400).json({ success: false, error: { message: 'dataAsOf must be YYYY-MM-DD' } });
    }

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(file.path);
    } catch (e) {
      logger.warn('Claim Data: workbook could not be read', { error: String((e as Error)?.message || e) });
      return res.status(400).json({ success: false, error: { message: 'The file could not be read as an Excel workbook.' } });
    }

    const parsed = parseClaimDataWorkbook(wb, kind);
    if (parsed.errors.length > 0) {
      return res.status(400).json({ success: false, error: { message: parsed.errors.join(' ') } });
    }

    const result = await importClaimData({
      kind,
      fileName: file.originalname,
      userId: req.user?.id ?? null,
      dataAsOf: asOfRaw || null,
      parsed,
    });
    return res.json({
      success: true,
      data: { ...result, sheetsRead: parsed.sheetsRead, subtotalRowsSkipped: parsed.subtotalRowsSkipped },
    });
  } catch (error) {
    logger.error('Claim Data upload failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to import Claim Data' } });
  }
};

export const listClaimDataUploads = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT u.id, u.kind, u.file_name, u.data_as_of::text AS data_as_of, u.uploaded_at,
              u.total_rows, u.susut_rows, u.mutu_rows, u.inserted_rows, u.replaced_rows, u.failed_rows,
              u.b2b_rows, u.direct_rows, u.unmatched_rows, u.total_qty, u.total_amount_idr,
              u.warnings, u.errors,
              us.full_name AS uploaded_by_name, us.username AS uploaded_by_username
         FROM claim_data_uploads u
         LEFT JOIN users us ON us.id = u.uploaded_by
        ORDER BY u.uploaded_at DESC
        LIMIT 50`,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List Claim Data uploads failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Data uploads' } });
  }
};

/** What the pages are running on right now: the latest upload of each kind and the live row counts. */
export const getClaimDataStatus = async (_req: AuthRequest, res: Response) => {
  try {
    const latest = await query(
      `SELECT DISTINCT ON (kind) kind, file_name, data_as_of::text AS data_as_of, uploaded_at, total_rows
         FROM claim_data_uploads ORDER BY kind, uploaded_at DESC`,
    );
    const counts = await query(
      `WITH ai AS (
         SELECT id FROM claim_susut_imports WHERE source_kind = 'claim_data' ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
       ), mi AS (
         SELECT id FROM claim_mutu_imports WHERE source_kind = 'claim_data' ORDER BY uploaded_at DESC NULLS LAST LIMIT 1
       )
       SELECT
         (SELECT COUNT(*)::int FROM claim_susut_rows r JOIN ai ON ai.id = r.import_id) AS os_susut,
         (SELECT COUNT(*)::int FROM claim_mutu_rows r JOIN mi ON mi.id = r.import_id) AS os_mutu,
         (SELECT COUNT(*)::int FROM claim_susut_real_rows r JOIN claim_susut_imports i ON i.id = r.import_id AND i.source_kind = 'claim_data') AS real_susut,
         (SELECT COUNT(*)::int FROM claim_mutu_real_rows r JOIN claim_mutu_imports i ON i.id = r.import_id AND i.source_kind = 'claim_data') AS real_mutu`,
    );
    const byKind: Record<string, unknown> = {};
    for (const row of latest.rows) byKind[row.kind] = row;
    return res.json({ success: true, data: { latest: byKind, counts: counts.rows[0] ?? {} } });
  } catch (error) {
    logger.error('Claim Data status failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Data status' } });
  }
};
