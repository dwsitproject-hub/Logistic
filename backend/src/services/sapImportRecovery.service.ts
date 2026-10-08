import { query } from '../database/connection';
import logger from '../utils/logger';
import { SAP_IMPORT_STALE_AFTER_MINUTES } from '../utils/sapImportInFlightSql';

/**
 * Mark SAP imports that can no longer be running as failed.
 *
 * An import that is still 'processing' / 'pending' long after it started was left behind - the backend restarted, or the
 * connection died between the commit and the status update. The only cleanup used to live in the SAP Import History list
 * endpoint (opening that page), so on a day nobody opened it, the leftover row blocked the daily folder import and every
 * Daily Planning / WB upload with no message anywhere.
 *
 * `olderThanMinutes` defaults to the same limit the in-flight checks use, so after this runs they agree with the table.
 * Called before each scheduler / Sync run, and once at start-up with a short limit (no import can be running in a process
 * that has just started).
 */
export async function failStaleSapImports(
  options: { olderThanMinutes?: number; reason?: string } = {},
): Promise<number> {
  const minutes = Math.max(1, Math.floor(options.olderThanMinutes ?? SAP_IMPORT_STALE_AFTER_MINUTES));
  const reason =
    options.reason ??
    `Import did not finish: no completion was recorded within ${minutes} minutes (most likely the backend restarted). Upload the file again.`;
  try {
    const result = await query(
      `UPDATE sap_data_imports
          SET status = 'failed',
              error_log = COALESCE(error_log, $1)
        WHERE status IN ('processing', 'pending')
          AND import_timestamp < NOW() - ($2::int * INTERVAL '1 minute')
        RETURNING id::text`,
      [JSON.stringify([reason]), minutes],
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.warn('Marked stale SAP imports as failed', {
        count,
        olderThanMinutes: minutes,
        importIds: result.rows.map((r: { id: string }) => r.id),
      });
    }
    return count;
  } catch (error) {
    // Recovery is best effort: it must never be the reason a run does not start.
    logger.error('Could not mark stale SAP imports as failed', { error });
    return 0;
  }
}
