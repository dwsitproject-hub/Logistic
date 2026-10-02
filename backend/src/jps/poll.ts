/** Poll JPS for the operator's decision on instructions KLIP has submitted. */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { jpsRequest } from './client';
import { applyJpsInstruction } from './applyInstruction';
import { jpsMinPollIntervalMs } from './config';
import type { JpsInstruction } from './types';

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
