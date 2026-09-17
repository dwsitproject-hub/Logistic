/**
 * Keep withdrawn contracts read-only.
 *
 * A contract is WITHDRAWN when SAP stopped reporting its PO for 2+ consecutive trusted imports,
 * i.e. the PO was cancelled or deleted upstream. Its KLIP-entered planning, ATAs and remarks are
 * deliberately preserved and remain visible, but they must not be edited any further: the
 * underlying commitment no longer exists in SAP, so new data entry against it cannot be
 * reconciled.
 *
 * Deliberately NOT blocked:
 *   - the SAP importer, which is not an HTTP path. It must stay free to restore a PO that
 *     reappears, which is what makes withdrawal reversible.
 *   - cancelling a shipment or trucking operation. Cancelling is the natural response to "SAP
 *     cancelled this", and blocking it would leave users with active-looking rows they cannot
 *     clear.
 */

import { Response, NextFunction } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from './auth';

export type PresenceTarget = 'contract' | 'shipment' | 'trucking';

const SQL_BY_TARGET: Record<PresenceTarget, string> = {
  contract: `SELECT c.sap_presence, TRIM(c.po_number) AS po_number
               FROM contracts c WHERE c.id = $1::uuid LIMIT 1`,
  shipment: `SELECT c.sap_presence, TRIM(c.po_number) AS po_number
               FROM shipments s JOIN contracts c ON c.id = s.contract_id
              WHERE s.id = $1::uuid LIMIT 1`,
  trucking: `SELECT c.sap_presence, TRIM(c.po_number) AS po_number
               FROM trucking_operations t JOIN contracts c ON c.id = t.contract_id
              WHERE t.id = $1::uuid LIMIT 1`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reject edits to a record whose contract has been withdrawn from SAP.
 * One indexed single-row lookup, only on mutating routes.
 */
export function blockWhenWithdrawn(target: PresenceTarget, paramName = 'id') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const id = String((req.params as Record<string, string>)?.[paramName] ?? '').trim();
    // Not a uuid (or absent) means the route addresses the record another way; let the
    // controller do its own validation rather than guessing here.
    if (!UUID_RE.test(id)) {
      next();
      return;
    }

    try {
      const result = await query(SQL_BY_TARGET[target], [id]);
      const row = result.rows[0];
      if (row && String(row.sap_presence) === 'WITHDRAWN') {
        logger.info('Blocked edit of SAP-withdrawn record', {
          target,
          id,
          poNumber: row.po_number,
          path: req.originalUrl,
          method: req.method,
        });
        res.status(409).json({
          success: false,
          error: {
            code: 'SAP_CONTRACT_WITHDRAWN',
            message:
              `This ${target} belongs to PO ${row.po_number ?? '(unknown)'}, which SAP no longer ` +
              'reports - it was cancelled or deleted upstream. Existing data is kept for ' +
              'reference but cannot be edited. If the PO returns in a SAP upload, KLIP restores ' +
              'it automatically and editing resumes.',
          },
        });
        return;
      }
      next();
    } catch (err) {
      // A guard must never take down a write path; fall through and let the controller run.
      logger.error('sapPresenceGuard lookup failed; allowing the request through', { target, id, err });
      next();
    }
  };
}
