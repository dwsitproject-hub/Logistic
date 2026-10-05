/**
 * Remember which masters KLIP could not deliver to DHM, so they can be shown and retried.
 *
 * Every push function returns the same shape (DhmPushAttachment), so the outcome is judged in ONE place, here:
 *
 *   dhmConflict            DHM holds a different record under that name/code (409)   -> CONFLICT, never auto-retried
 *   dhmError               unreachable, rejected, or a parent not in DHM yet         -> FAILED, retried with backoff
 *   dhmStatus / dhmCode    DHM confirmed the row                                     -> the state row is deleted
 *   {} (nothing)           DHM is switched off, or there was nothing to send         -> left alone
 *
 * Recording must never break the save that triggered it: a failure to write the state is logged and swallowed.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { asDhmUuid } from './masterReplica';
import type { DhmPushAttachment } from './pushVessel';

export const DHM_PUSH_KINDS = ['vessel', 'product', 'port', 'plant', 'site', 'company', 'ext_company', 'incoterm'] as const;
export type DhmPushKind = (typeof DHM_PUSH_KINDS)[number];

export function isDhmPushKind(value: unknown): value is DhmPushKind {
  return (DHM_PUSH_KINDS as readonly string[]).includes(String(value));
}

/** After this many failed attempts the row waits for a person (the Integrations page has a Retry button). */
export const MAX_AUTO_PUSH_ATTEMPTS = 8;

const MINUTE = 60_000;
/** Wait before attempt N+1, by the number of attempts made so far. The cron ticks every 15 minutes, which rounds these up. */
const BACKOFF_MS = [5 * MINUTE, 15 * MINUTE, 30 * MINUTE, 60 * MINUTE, 2 * 60 * MINUTE, 4 * 60 * MINUTE, 8 * 60 * MINUTE];

/** Milliseconds to wait after `attempts` failed attempts, or null when the automatic attempts are used up. */
export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_AUTO_PUSH_ATTEMPTS) return null;
  return BACKOFF_MS[Math.max(0, attempts - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

export type DhmPushOutcome =
  | { state: 'synced' }
  | { state: 'failed'; error: string }
  | { state: 'conflict'; error: string | null }
  | { state: 'ignored' };

export function classifyPush(result: DhmPushAttachment | null | undefined): DhmPushOutcome {
  if (!result) return { state: 'ignored' };
  if (result.dhmConflict) return { state: 'conflict', error: result.dhmError ?? null };
  if (result.dhmError) return { state: 'failed', error: String(result.dhmError) };
  if (result.dhmStatus || result.dhmCode) return { state: 'synced' };
  return { state: 'ignored' };
}

/** Write what a push did. Never throws. */
export async function recordPushOutcome(
  kind: DhmPushKind,
  localId: string,
  result: DhmPushAttachment | null | undefined,
): Promise<void> {
  try {
    const id = asDhmUuid(localId);
    if (!id) return;
    const outcome = classifyPush(result);
    if (outcome.state === 'ignored') return;

    if (outcome.state === 'synced') {
      await query(`DELETE FROM dhm_push_state WHERE entity_kind = $1 AND entity_id = $2::uuid`, [kind, id]);
      return;
    }

    if (outcome.state === 'conflict') {
      await query(
        `INSERT INTO dhm_push_state (entity_kind, entity_id, status, error, attempts, next_attempt_at)
         VALUES ($1, $2::uuid, 'CONFLICT', $3, 1, NULL)
         ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
           status = 'CONFLICT', error = EXCLUDED.error, next_attempt_at = NULL, last_attempt_at = NOW()`,
        [kind, id, outcome.error],
      );
      return;
    }

    const previous = await query(
      `SELECT attempts FROM dhm_push_state WHERE entity_kind = $1 AND entity_id = $2::uuid`,
      [kind, id],
    );
    const attempts = Number(previous.rows[0]?.attempts ?? 0) + 1;
    const delay = retryDelayMs(attempts);
    await query(
      `INSERT INTO dhm_push_state (entity_kind, entity_id, status, error, attempts, next_attempt_at)
       VALUES ($1, $2::uuid, 'FAILED', $3, $4,
               CASE WHEN $5::bigint IS NULL THEN NULL ELSE NOW() + ($5::bigint || ' milliseconds')::interval END)
       ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
         status = 'FAILED', error = EXCLUDED.error, attempts = EXCLUDED.attempts,
         next_attempt_at = EXCLUDED.next_attempt_at, last_attempt_at = NOW()`,
      [kind, id, outcome.error, attempts, delay],
    );
  } catch (error) {
    logger.warn('DHM push state not recorded', {
      kind,
      localId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface DhmPushStateRow {
  entity_kind: DhmPushKind;
  entity_id: string;
  status: 'FAILED' | 'CONFLICT';
  error: string | null;
  attempts: number;
  first_failed_at: string;
  last_attempt_at: string;
  next_attempt_at: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Put `dhm_push_status` / `dhm_push_error` on list rows that have an undelivered push, for the DHM Status badge of the
 * Master tables. One query per list call; rows with a non-uuid id (the Master Port list also carries names taken from
 * shipments) are skipped.
 */
export async function attachDhmPushState<T extends { id?: unknown }>(kind: DhmPushKind, items: T[]): Promise<T[]> {
  try {
    const ids = items.map((r) => String(r.id ?? '')).filter((id) => UUID_RE.test(id));
    if (ids.length === 0) return items;
    const result = await query(
      `SELECT entity_id::text AS entity_id, status, error, attempts, next_attempt_at
       FROM dhm_push_state
       WHERE entity_kind = $1 AND entity_id = ANY($2::uuid[])`,
      [kind, ids],
    );
    if (result.rows.length === 0) return items;
    const byId = new Map<string, Record<string, unknown>>(
      (result.rows as Array<Record<string, unknown>>).map((r) => [String(r.entity_id), r]),
    );
    return items.map((item) => {
      const state = byId.get(String(item.id ?? ''));
      if (!state) return item;
      return {
        ...item,
        dhm_push_status: state.status,
        dhm_push_error: state.error ?? null,
        dhm_push_attempts: Number(state.attempts),
        dhm_push_next_attempt_at: state.next_attempt_at ?? null,
      };
    });
  } catch (error) {
    // The badge is a nicety; the list must still load.
    logger.warn('DHM push state not attached to the list', {
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return items;
  }
}
