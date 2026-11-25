import type { NextFunction, Request, Response } from 'express';
import logger from './logger';

/**
 * Logs every request of a router that takes longer than a threshold, with its duration: "commdocs slow request {method, path, status, ms, user}".
 * Built for the Commercial Documents (COD) "uploads are slow" report: morgan's 'combined' log has no durations, so there was no way to see after
 * the fact which requests (the table, the summary cards, the file list, the preview, the upload itself) were slow. Quiet by design: nothing is
 * logged under the threshold. The path has no query string.
 */
export function slowRequestLog(label: string, thresholdMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      if (ms < thresholdMs) return;
      const user = (req as Request & { user?: { username?: string; email?: string } }).user;
      logger.info(`${label} slow request`, {
        method: req.method,
        path: String(req.originalUrl || req.url || '').split('?')[0],
        status: res.statusCode,
        ms,
        user: user?.username || user?.email || null,
      });
    });
    next();
  };
}
