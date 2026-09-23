/** Submit eligible STOs to JPS and record the outcome. */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { jpsRequest } from './client';
import { jpsMaxSubmitsPerSweep, jpsPortId, jpsRegionSite } from './config';
import { findEligibleStos } from './eligibility';
import { buildJpsExternalReference, buildJpsSubmitPayload } from './mapper';
import type { JpsInstruction, JpsSubmitPayload } from './types';

/**
 * KLIP has no shipping-agent master, and JPS requires `agent_name`. Ryan chose a fixed "Other"
 * for now; it is a real row in JPS master data (`GET /agents` id 5), so it passes validation.
 */
const JPS_AGENT_NAME = 'Other';

export interface JpsSubmitSummary {
  considered: number;
  submitted: number;
  recovered: number;
  held: number;
  failed: number;
}

/** Next revision for an STO. Rejected instructions cannot be amended - only replaced. */
async function nextRevision(stoKey: string): Promise<number> {
  const res = await query(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM jps_shipping_instructions WHERE sto_key = $1`,
    [stoKey],
  );
  return Number(res.rows[0]?.next ?? 1);
}

async function recordHeld(stoKey: string, revision: number, problems: string[]): Promise<void> {
  await query(
    `INSERT INTO jps_shipping_instructions (sto_key, external_reference, revision, state, last_error)
     VALUES ($1, $2, $3, 'SKIPPED_NO_CARGO', $4)
     ON CONFLICT (sto_key, revision) DO UPDATE SET
       state = 'SKIPPED_NO_CARGO',
       last_error = EXCLUDED.last_error,
       updated_at = CURRENT_TIMESTAMP`,
    [stoKey, buildJpsExternalReference(stoKey, revision), revision, problems.join('; ')],
  );
}

async function recordSubmitted(
  stoKey: string,
  revision: number,
  payload: JpsSubmitPayload,
  data: JpsInstruction,
): Promise<void> {
  await query(
    `INSERT INTO jps_shipping_instructions (
       sto_key, external_reference, revision, state, jps_id, jps_status, submitted_at, payload, last_error
     ) VALUES ($1, $2, $3, 'SUBMITTED', $4, $5, CURRENT_TIMESTAMP, $6::jsonb, NULL)
     ON CONFLICT (sto_key, revision) DO UPDATE SET
       state = 'SUBMITTED',
       jps_id = EXCLUDED.jps_id,
       jps_status = EXCLUDED.jps_status,
       submitted_at = COALESCE(jps_shipping_instructions.submitted_at, EXCLUDED.submitted_at),
       payload = EXCLUDED.payload,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [
      stoKey,
      payload.external_reference,
      revision,
      data.id,
      data.status,
      JSON.stringify(payload),
    ],
  );
}

async function recordFailed(
  stoKey: string,
  revision: number,
  payload: JpsSubmitPayload,
  message: string,
  requestId?: string,
): Promise<void> {
  await query(
    `INSERT INTO jps_shipping_instructions (
       sto_key, external_reference, revision, state, last_error, request_id, payload
     ) VALUES ($1, $2, $3, 'FAILED', $4, $5, $6::jsonb)
     ON CONFLICT (sto_key, revision) DO UPDATE SET
       state = 'FAILED',
       last_error = EXCLUDED.last_error,
       request_id = EXCLUDED.request_id,
       payload = EXCLUDED.payload,
       updated_at = CURRENT_TIMESTAMP`,
    [stoKey, payload.external_reference, revision, message, requestId ?? null, JSON.stringify(payload)],
  );
}

/**
 * One submission pass.
 *
 * A retryable failure - a timeout, a 429, a 5xx - writes NO row on purpose. The next sweep finds
 * the STO eligible again and resubmits; if JPS did create the instruction before the connection
 * dropped, the resubmit comes back 409 and the id is recovered by reference. That is precisely
 * what `external_reference` is for, and it is the only way a partner can tell the two cases apart.
 */
export async function submitEligibleStos(): Promise<JpsSubmitSummary> {
  const summary: JpsSubmitSummary = { considered: 0, submitted: 0, recovered: 0, held: 0, failed: 0 };
  const eligible = await findEligibleStos(jpsRegionSite(), jpsMaxSubmitsPerSweep());
  summary.considered = eligible.length;

  for (const sto of eligible) {
    const revision = await nextRevision(sto.sto_key);
    const built = buildJpsSubmitPayload(
      { ...sto, revision },
      { portId: jpsPortId(), agentName: JPS_AGENT_NAME },
    );

    if (!built.payload) {
      await recordHeld(sto.sto_key, revision, built.problems);
      summary.held += 1;
      logger.info('JPS: STO held back', { stoKey: sto.sto_key, problems: built.problems });
      continue;
    }

    const payload = built.payload;
    const res = await jpsRequest<JpsInstruction>({
      method: 'POST',
      url: '/shipping-instructions',
      data: payload,
    });

    if (res.ok) {
      await recordSubmitted(sto.sto_key, revision, payload, res.data);
      summary.submitted += 1;
      continue;
    }

    if (res.code === 'DUPLICATE_REFERENCE') {
      // JPS already holds this reference - an earlier attempt reached it and the response did not
      // reach us. Recover the id rather than burning a revision on a duplicate.
      const found = await jpsRequest<JpsInstruction>({
        method: 'GET',
        url: '/shipping-instructions',
        params: { external_reference: payload.external_reference },
      });
      if (found.ok) {
        await recordSubmitted(sto.sto_key, revision, payload, found.data);
        summary.recovered += 1;
        continue;
      }
      await recordFailed(sto.sto_key, revision, payload, `duplicate reference, recovery failed: ${found.message}`, found.requestId);
      summary.failed += 1;
      continue;
    }

    if (res.retryable) {
      // No row: leave the STO eligible so the next sweep tries again.
      logger.warn('JPS submit will be retried', {
        stoKey: sto.sto_key,
        status: res.status,
        code: res.code,
      });
      continue;
    }

    const detail = (res.details ?? [])
      .map((d) => `${d.field ?? '?'}: ${d.issue ?? ''}`)
      .join('; ');
    await recordFailed(
      sto.sto_key,
      revision,
      payload,
      `${res.code}: ${res.message}${detail ? ` (${detail})` : ''}`,
      res.requestId,
    );
    summary.failed += 1;
    logger.warn('JPS rejected a submission', {
      stoKey: sto.sto_key,
      code: res.code,
      detail,
      requestId: res.requestId,
    });
  }

  return summary;
}
