/**
 * Block bulk trucking uploads while a SAP MASTER import is still running.
 * Daily Planning / WB read and write contract + trucking data that the importer
 * is mutating in a long transaction — concurrent uploads cause conflicts.
 *
 * Fail-open on DB errors (same pattern as sapPresenceGuard).
 */

import { Response, NextFunction } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from './auth';
import { SQL_SAP_IMPORT_IN_FLIGHT_EXISTS } from '../utils/sapImportInFlightSql';

export const SAP_IMPORT_IN_PROGRESS_CODE = 'SAP_IMPORT_IN_PROGRESS';

export const SAP_IMPORT_IN_PROGRESS_MESSAGE =
  'SAP data import is still running. Wait until it completes before uploading Daily Planning or WB.';

export async function sapImportInFlightGuard(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await query(SQL_SAP_IMPORT_IN_FLIGHT_EXISTS);
    if (result.rows.length > 0) {
      logger.info('Blocked upload while SAP import in progress', {
        path: req.originalUrl,
        method: req.method,
        userId: req.user?.id,
      });
      res.status(409).json({
        success: false,
        error: {
          code: SAP_IMPORT_IN_PROGRESS_CODE,
          message: SAP_IMPORT_IN_PROGRESS_MESSAGE,
        },
      });
      return;
    }
    next();
  } catch (err) {
    logger.error('sapImportInFlightGuard lookup failed; allowing the request through', {
      path: req.originalUrl,
      err,
    });
    next();
  }
}
