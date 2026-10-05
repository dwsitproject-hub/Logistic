/**
 * Push again the masters that did not reach DHM.
 *
 * Runs after every DHM pull (the cron) for the FAILED rows that are due, and on demand from the Integrations page. A
 * retry reloads the master and pushes its CURRENT data; whatever happened to it since is what DHM receives. It never
 * overwrites a record DHM already holds under that name (overwrite is always false here): that is a CONFLICT, and a
 * person decides.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { isDhmEnabled } from './config';
import { loadRowsByIds, pushRow, rowName, type DhmSyncMaster } from './pushCatalog';
import { isDhmPushKind, type DhmPushKind, type DhmPushStateRow } from './pushState';

export interface DhmRetrySummary {
  disabled: boolean;
  attempted: number;
  synced: number;
  stillFailing: number;
  /** The master no longer exists, so there was nothing left to deliver. */
  dropped: number;
}

/**
 * Retry FAILED rows. `onlyDue` is the cron's behaviour (respect the backoff); the button passes false to retry now,
 * including rows whose automatic attempts are used up.
 */
export async function retryDhmPushes(options: { onlyDue: boolean; limit?: number }): Promise<DhmRetrySummary> {
  const summary: DhmRetrySummary = { disabled: false, attempted: 0, synced: 0, stillFailing: 0, dropped: 0 };
  if (!isDhmEnabled()) return { ...summary, disabled: true };

  const limit = Math.min(200, Math.max(1, options.limit ?? 25));
  const due = await query(
    `SELECT entity_kind, entity_id::text AS entity_id
     FROM dhm_push_state
     WHERE status = 'FAILED'
       ${options.onlyDue ? 'AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()' : ''}
     ORDER BY last_attempt_at
     LIMIT $1`,
    [limit],
  );

  const idsByKind = new Map<DhmPushKind, string[]>();
  for (const row of due.rows as Array<{ entity_kind: string; entity_id: string }>) {
    if (!isDhmPushKind(row.entity_kind)) continue;
    idsByKind.set(row.entity_kind, [...(idsByKind.get(row.entity_kind) ?? []), row.entity_id]);
  }

  for (const [kind, ids] of idsByKind) {
    const rows = await loadRowsByIds(kind as DhmSyncMaster, ids);
    const found = new Set(rows.map((r) => String(r.id)));
    for (const id of ids) {
      if (found.has(id)) continue;
      await query(`DELETE FROM dhm_push_state WHERE entity_kind = $1 AND entity_id = $2::uuid`, [kind, id]);
      summary.dropped += 1;
    }
    for (const row of rows) {
      summary.attempted += 1;
      try {
        const result = await pushRow(kind as DhmSyncMaster, row, false);
        if (result.dhmError || result.dhmConflict) summary.stillFailing += 1;
        else summary.synced += 1;
      } catch (error) {
        summary.stillFailing += 1;
        logger.warn('DHM push retry failed', {
          kind,
          name: rowName(kind as DhmSyncMaster, row),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (summary.attempted > 0 || summary.dropped > 0) logger.info('DHM push retry finished', summary);
  return summary;
}

/** Everything undelivered, newest first, with a name for each so a person can find the row. */
export async function listDhmPushStates(limit = 200): Promise<Array<DhmPushStateRow & { name: string }>> {
  const states = await query(
    `SELECT entity_kind, entity_id::text AS entity_id, status, error, attempts,
            first_failed_at, last_attempt_at, next_attempt_at
     FROM dhm_push_state
     ORDER BY last_attempt_at DESC
     LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  const rows = states.rows as DhmPushStateRow[];
  const idsByKind = new Map<DhmPushKind, string[]>();
  for (const s of rows) {
    if (!isDhmPushKind(s.entity_kind)) continue;
    idsByKind.set(s.entity_kind, [...(idsByKind.get(s.entity_kind) ?? []), s.entity_id]);
  }
  const names = new Map<string, string>();
  for (const [kind, ids] of idsByKind) {
    for (const row of await loadRowsByIds(kind as DhmSyncMaster, ids)) {
      names.set(`${kind}:${row.id}`, rowName(kind as DhmSyncMaster, row));
    }
  }
  return rows.map((s) => ({ ...s, name: names.get(`${s.entity_kind}:${s.entity_id}`) ?? '(deleted)' }));
}
