/** Poll JPS for the operator's decision on instructions KLIP has submitted. */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { jpsRequest } from './client';
import { applyJpsInstruction } from './applyInstruction';
import { jpsMinPollIntervalMs } from './config';
import type { JpsInstruction } from './types';

/**
 * JPS answers NOT_FOUND ("Shipping instruction 103 not found") for an instruction it no longer holds: an operator deleted it before the Deleted status
 * existed, or its staging data was cleared. That is JPS's own application answer (a gateway or server problem comes back 5xx and is retryable), and the
 * instruction was looked up by the id JPS itself gave us. KLIP records it as Deleted, the closed status that already lets the STO be resubmitted
 * (next revision) and stops it being polled. Before, such an instruction stayed Pending / Approved / Allocated for ever, locked the Submit to Jetty
 * button, and cost a 404 poll on every sweep.
 */
async function markInstructionGone(rowId: string, message: string): Promise<void> {
  await query(
    `UPDATE jps_shipping_instructions
        SET jps_status = 'Deleted',
            last_polled_at = NOW(),
            last_error = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND state = 'SUBMITTED' AND jps_status IS DISTINCT FROM 'Deleted'`,
    [rowId, `${message} (JPS no longer holds it: marked Deleted by KLIP)`],
  );
}

export interface JpsPollSummary {
  polled: number;
  changed: number;
  errors: number;
}

/**
 * One polling pass.
 *
 * Only instructions that can still move are polled. Under v5.0 that means `Rejected` and `Sailed`
 * are terminal and `Allocated` is not: the berthing milestones - TA, TB, ETC, cast off - arrive
 * after allocation, so stopping there would mean never seeing them.
 *
 * The partner API asks for at most one poll per instruction per five minutes, which
 * `last_polled_at` enforces. The index backing this is partial on the same predicate.
 */
export async function pollSubmittedInstructions(limit = 50): Promise<JpsPollSummary> {
  const summary: JpsPollSummary = { polled: 0, changed: 0, errors: 0 };

  const due = await query(
    `SELECT id, sto_key, jps_id, external_reference, jps_status
     FROM jps_shipping_instructions
     WHERE state = 'SUBMITTED'
       AND COALESCE(jps_status, 'Pending') IN ('Pending', 'Approved', 'Allocated')
       AND (last_polled_at IS NULL OR last_polled_at < NOW() - ($1::bigint || ' milliseconds')::interval)
     ORDER BY last_polled_at NULLS FIRST
     LIMIT $2`,
    [jpsMinPollIntervalMs(), limit],
  );

  for (const row of due.rows as Array<Record<string, unknown>>) {
    const jpsId = row.jps_id == null ? null : Number(row.jps_id);
    const audit = { audit: { stoKey: String(row.sto_key), kind: 'poll' as const } };
    const res = jpsId
      ? await jpsRequest<JpsInstruction>({ method: 'GET', url: `/shipping-instructions/${jpsId}` }, audit)
      : await jpsRequest<JpsInstruction>(
          {
            method: 'GET',
            url: '/shipping-instructions',
            params: { external_reference: String(row.external_reference) },
          },
          audit,
        );

    summary.polled += 1;

    if (!res.ok && res.code === 'NOT_FOUND' && jpsId) {
      await markInstructionGone(row.id as string, `${res.code}: ${res.message}`);
      summary.changed += 1;
      logger.info('JPS instruction no longer exists at JPS: marked Deleted', { stoKey: row.sto_key, jpsId, from: row.jps_status });
      continue;
    }

    if (!res.ok) {
      // Stamp last_polled_at even on failure, or a permanently unreachable instruction would be
      // retried on every sweep and crowd out the ones that can still make progress.
      await query(
        `UPDATE jps_shipping_instructions
         SET last_polled_at = NOW(), last_error = $2, request_id = COALESCE($3, request_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, `${res.code}: ${res.message}`, res.requestId ?? null],
      );
      summary.errors += 1;
      logger.warn('JPS poll failed', { stoKey: row.sto_key, code: res.code, status: res.status });
      continue;
    }

    const data = res.data;
    const changed = String(row.jps_status ?? '') !== String(data.status ?? '');
    await applyJpsInstruction(row.id as string, data);

    if (changed) {
      summary.changed += 1;
      logger.info('JPS status changed', {
        stoKey: row.sto_key,
        from: row.jps_status,
        to: data.status,
        jetty: data.allocation?.jetty_name ?? null,
      });
    }
  }

  return summary;
}

export type RefreshOutcome =
  | { kind: 'refreshed'; status: string | null; previousStatus: string | null; changed: boolean }
  /** JPS asks for at most one poll per instruction per few minutes; the answer says how long until the next one is allowed. */
  | { kind: 'too_soon'; retryInSeconds: number; status: string | null }
  | { kind: 'none' }
  | { kind: 'failed'; message: string };

/**
 * Ask JPS NOW what it holds for ONE STO's instruction (the Submit to Jetty dialog's Refresh button), instead of waiting for the next sweep.
 * It reads the same instruction the sweep would and writes it through the same applyJpsInstruction, so a rejection that happened at JPS shows up the
 * same way whether it arrives here, by the sweep or by webhook. The per-instruction poll interval still applies.
 */
export async function refreshInstructionFromJps(stoKey: string): Promise<RefreshOutcome> {
  const res = await query(
    `SELECT id, jps_id, external_reference, jps_status, last_polled_at
       FROM jps_shipping_instructions
      WHERE sto_key = $1 AND state = 'SUBMITTED'
      ORDER BY revision DESC
      LIMIT 1`,
    [stoKey],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { kind: 'none' };

  const status = row.jps_status ? String(row.jps_status) : null;
  const intervalMs = jpsMinPollIntervalMs();
  const last = row.last_polled_at ? new Date(row.last_polled_at as string).getTime() : 0;
  const waitMs = last + intervalMs - Date.now();
  if (last && waitMs > 0) return { kind: 'too_soon', retryInSeconds: Math.ceil(waitMs / 1000), status };

  const jpsId = row.jps_id == null ? null : Number(row.jps_id);
  const audit = { audit: { stoKey, kind: 'poll' as const } };
  const answer = jpsId
    ? await jpsRequest<JpsInstruction>({ method: 'GET', url: `/shipping-instructions/${jpsId}` }, audit)
    : await jpsRequest<JpsInstruction>(
        { method: 'GET', url: '/shipping-instructions', params: { external_reference: String(row.external_reference) } },
        audit,
      );
  if (!answer.ok && answer.code === 'NOT_FOUND' && jpsId) {
    await markInstructionGone(row.id as string, `${answer.code}: ${answer.message}`);
    return { kind: 'refreshed', status: 'Deleted', previousStatus: status, changed: true };
  }
  if (!answer.ok) {
    await query(`UPDATE jps_shipping_instructions SET last_polled_at = NOW(), last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      row.id,
      `${answer.code}: ${answer.message}`,
    ]);
    return { kind: 'failed', message: `${answer.code}: ${answer.message}` };
  }

  await applyJpsInstruction(row.id as string, answer.data);
  const now = answer.data.status ? String(answer.data.status) : null;
  return { kind: 'refreshed', status: now, previousStatus: status, changed: (status ?? '') !== (now ?? '') };
}
