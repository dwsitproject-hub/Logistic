import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { COD_FILES_SQL, COD_FILE_TYPES, groupCodFiles, isCodFileType, type CodFileRow } from '../utils/codFiles';

/** PO keys a page may ask about at once (an STO carries a handful of POs; this only bounds a hand-written URL). */
const MAX_PO_KEYS = 50;

const csv = (raw: unknown): string[] =>
  Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );

/**
 * GET /documents/cod-files?po=<po>,<po>&types=contract,delivery_order - the files uploaded in Commercial Documents for these POs, one group per PO and type with every version
 * (newest first). Read only: the files are opened through COD's own /commercial-documents/file/:id/view|download. The same permission as COD (page.commercial_documents can_view),
 * so a KLIP user who may not open COD does not see its files here either; the page treats the 403 as "nothing to show".
 */
export const listCodFiles = async (req: AuthRequest, res: Response) => {
  try {
    const poKeys = csv(req.query.po).slice(0, MAX_PO_KEYS);
    if (poKeys.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'po is required' } });
    }
    const asked = csv(req.query.types);
    const types = asked.length > 0 ? asked.filter(isCodFileType) : [...COD_FILE_TYPES];
    if (types.length === 0) {
      return res.status(400).json({ success: false, error: { message: `types must be among ${COD_FILE_TYPES.join(', ')}` } });
    }
    const result = await query(COD_FILES_SQL, [poKeys, types]);
    return res.json({ success: true, data: { groups: groupCodFiles(result.rows as CodFileRow[]) } });
  } catch (error) {
    logger.error('List COD files failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load the Commercial Documents files' } });
  }
};
