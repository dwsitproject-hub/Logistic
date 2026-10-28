/** Submit eligible STOs to JPS and record the outcome. */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { jpsRequest } from './client';
import { companiesForPort, fetchJpsPortCompanies } from './companies';
import { fetchJpsKnownPorts, type JpsKnownPorts } from './portCatalog';
import {
  jpsMaxSubmitsPerSweep,
  jpsEnabledPortNames,
  jpsRetryFailed,
  jpsRetryFailedAfterMs,
} from './config';
import { findEligibleStos, type EligibleSto } from './eligibility';
import { buildJpsExternalReference, buildJpsSubmitPayload } from './mapper';
import type { JpsErrorDetail, JpsInstruction, JpsSubmitPayload } from './types';

/**
 * One validation detail as a line for `last_error`. JPS puts the allowed values next to the issue (`valid_cargo_hub_codes`,
 * `valid_company_hub_codes`, ...); a rejection that does not say what would have been accepted cannot be fixed from KLIP.
 */
export function describeJpsDetail(detail: JpsErrorDetail): string {
  const allowed = Object.entries(detail)
    .filter(([key, value]) => key.startsWith('valid_') && Array.isArray(value))
    .map(([key, value]) => `${key}=${(value as unknown[]).join('|')}`);
  return `${detail.field ?? '?'}: ${detail.issue ?? ''}${allowed.length ? ` [${allowed.join('; ')}]` : ''}`;
}

export interface JpsSubmitSummary {
  considered: number;
  submitted: number;
  recovered: number;
  held: number;
  failed: number;
  /**
   * Held / failed rows whose state or message is NEW or DIFFERENT from what the Shipments list last showed. A held STO is looked at again on every sweep and
   * an unchanged one must not clear the list's cache each time; one that has just failed, or whose reason has changed, must, or its badge stays "Not Sent"
   * for up to an hour.
   */
  listChanged: number;
}

/** True when this (sto, revision) is not recorded yet, or is recorded in another state or with another message. */
async function rowWouldChange(stoKey: string, revision: number, state: string, message: string): Promise<boolean> {
  const prev = await query(
    `SELECT state, last_error FROM jps_shipping_instructions WHERE sto_key = $1 AND revision = $2`,
    [stoKey, revision],
  );
  const row = prev.rows[0] as { state?: string; last_error?: string | null } | undefined;
  return !row || row.state !== state || (row.last_error ?? '') !== message;
}

/**
 * The revision to submit under.
 *
 * Normally one past the highest: an instruction JPS already holds cannot be amended, so a
 * replacement needs a reference JPS has not seen.
 *
 * A row that never reached JPS is the exception, and reusing its revision is the point. FAILED means the POST was
 * rejected - a 400, a 401, a 404 - so JPS created nothing and `KLIP-<sto>-R<n>` is still an unused
 * reference. SKIPPED_NO_CARGO means KLIP held the STO back before sending anything (a product, vessel or
 * port without a DHM code, a company JPS does not map): it is looked at again on EVERY sweep, and counting
 * one past the highest each time wrote a new row every 15 minutes and climbed the reference (an STO held eight
 * times went out as R9, with eight held rows behind it). Incrementing would leave a trail of abandoned numbers,
 * and with retries switched on the reference would climb one per sweep while nothing about the payload had changed.
 */
async function nextRevision(stoKey: string): Promise<number> {
  const res = await query(
    `SELECT COALESCE(MAX(revision), 0) AS highest,
            COALESCE(MAX(revision) FILTER (WHERE state IN ('FAILED', 'SKIPPED_NO_CARGO')), 0) AS highest_unsent
       FROM jps_shipping_instructions WHERE sto_key = $1`,
    [stoKey],
  );
  const highest = Number(res.rows[0]?.highest ?? 0);
  const highestUnsent = Number(res.rows[0]?.highest_unsent ?? 0);
  if (highestUnsent > 0 && highestUnsent === highest) return highestUnsent;
  return highest + 1;
}

/** Returns whether the list would now read differently (see JpsSubmitSummary.listChanged). */
async function recordHeld(stoKey: string, revision: number, problems: string[]): Promise<boolean> {
  const changed = await rowWouldChange(stoKey, revision, 'SKIPPED_NO_CARGO', problems.join('; '));
  await query(
    `INSERT INTO jps_shipping_instructions (sto_key, external_reference, revision, state, last_error)
     VALUES ($1, $2, $3, 'SKIPPED_NO_CARGO', $4)
     ON CONFLICT (sto_key, revision) DO UPDATE SET
       state = 'SKIPPED_NO_CARGO',
       last_error = EXCLUDED.last_error,
       updated_at = CURRENT_TIMESTAMP`,
    [stoKey, buildJpsExternalReference(stoKey, revision), revision, problems.join('; ')],
  );
  return changed;
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
): Promise<boolean> {
  const changed = await rowWouldChange(stoKey, revision, 'FAILED', message);
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
  return changed;
}

/** What happened to one STO's submission. Written to the tracker for held / failed; a retryable failure writes nothing. */
export type SubmitOutcome =
  | { kind: 'submitted'; revision: number; instruction: JpsInstruction }
  | { kind: 'recovered'; revision: number; instruction: JpsInstruction }
  | { kind: 'held'; revision: number; problems: string[]; listChanged: boolean }
  | {
      kind: 'failed';
      revision: number;
      message: string;
      code?: string;
      /** JPS's validation details, one line each (field, issue, and the values it would accept). */
      details: string[];
      requestId?: string;
      listChanged: boolean;
    }
  | { kind: 'retryable'; message: string; code?: string; status?: number; requestId?: string };

/**
 * Submit ONE eligible STO: build the payload, POST it, and record the answer. The sweep and the Submit to Jetty button both go through here, so a button press
 * behaves exactly like a sweep that picked the STO up - same revision rule, same duplicate recovery, same rows.
 *
 * A retryable failure - a timeout, a 429, a 5xx - writes NO row on purpose. The next sweep finds
 * the STO eligible again and resubmits; if JPS did create the instruction before the connection
 * dropped, the resubmit comes back 409 and the id is recovered by reference. That is precisely
 * what `external_reference` is for, and it is the only way a partner can tell the two cases apart.
 */
export async function submitOneSto(
  sto: EligibleSto,
  portCatalog: Awaited<ReturnType<typeof fetchJpsPortCompanies>>,
  knownPorts: JpsKnownPorts | null = null,
): Promise<SubmitOutcome> {
  const revision = await nextRevision(sto.sto_key);
  const built = buildJpsSubmitPayload(
    { ...sto, revision },
    { portCompanies: companiesForPort(portCatalog, sto.port_hub_code), knownPortCodes: knownPorts },
  );

  if (!built.payload) {
    const listChanged = await recordHeld(sto.sto_key, revision, built.problems);
    logger.info('JPS: STO held back', { stoKey: sto.sto_key, problems: built.problems });
    return { kind: 'held', revision, problems: built.problems, listChanged };
  }

  const payload = built.payload;
  const res = await jpsRequest<JpsInstruction>(
    {
      method: 'POST',
      url: '/shipping-instructions',
      data: payload,
    },
    { audit: { stoKey: sto.sto_key, kind: 'submit' } },
  );

  if (res.ok) {
    await recordSubmitted(sto.sto_key, revision, payload, res.data);
    return { kind: 'submitted', revision, instruction: res.data };
  }

  if (res.code === 'DUPLICATE_REFERENCE') {
    // JPS already holds this reference - an earlier attempt reached it and the response did not
    // reach us. Recover the id rather than burning a revision on a duplicate.
    const found = await jpsRequest<JpsInstruction>(
      {
        method: 'GET',
        url: '/shipping-instructions',
        params: { external_reference: payload.external_reference },
      },
      { audit: { stoKey: sto.sto_key, kind: 'recover' } },
    );
    if (found.ok) {
      await recordSubmitted(sto.sto_key, revision, payload, found.data);
      return { kind: 'recovered', revision, instruction: found.data };
    }
    const message = `duplicate reference, recovery failed: ${found.message}`;
    const listChanged = await recordFailed(sto.sto_key, revision, payload, message, found.requestId);
    return { kind: 'failed', revision, message, code: found.code, details: [], requestId: found.requestId, listChanged };
  }

  if (res.retryable) {
    // No row: leave the STO eligible so the next sweep tries again.
    // The message, request id and the reference JPS keys the instruction by are what JPS support needs to find
    // this call. Without them a 500 INTERNAL_ERROR was a bare status line that nobody on the JPS side could trace.
    logger.warn('JPS submit will be retried', {
      stoKey: sto.sto_key,
      externalReference: payload.external_reference,
      cargoLines: payload.cargo.length,
      status: res.status,
      code: res.code,
      jpsMessage: res.message,
      requestId: res.requestId,
      // A retryable failure writes no row, so this is the only record of what JPS answered 500 to. It holds no
      // secret (vessel, port, quantities, a reference), and JPS support needs the body to find the cause.
      payload: JSON.stringify(payload),
    });
    return { kind: 'retryable', message: res.message, code: res.code, status: res.status, requestId: res.requestId };
  }

  const details = (res.details ?? []).map(describeJpsDetail);
  const detail = details.join('; ');
  const message = `${res.code}: ${res.message}${detail ? ` (${detail})` : ''}`;
  const listChanged = await recordFailed(sto.sto_key, revision, payload, message, res.requestId);
  logger.warn('JPS rejected a submission', {
    stoKey: sto.sto_key,
    code: res.code,
    detail,
    requestId: res.requestId,
  });
  return { kind: 'failed', revision, message, code: res.code, details, requestId: res.requestId, listChanged };
}

/** One submission pass: every STO the rule owes JPS, up to the per-sweep cap. */
export async function submitEligibleStos(): Promise<JpsSubmitSummary> {
  const summary: JpsSubmitSummary = { considered: 0, submitted: 0, recovered: 0, held: 0, failed: 0, listChanged: 0 };
  // One query for every port switched on (Integrations > JPS > Ports), under the one per-sweep cap. With no port switched on it matches nothing.
  const eligible: EligibleSto[] = await findEligibleStos(jpsEnabledPortNames(), jpsMaxSubmitsPerSweep(), {
    retryFailed: jpsRetryFailed(),
    retryFailedAfterMs: jpsRetryFailedAfterMs(),
  });
  summary.considered = eligible.length;

  // v5.6: which companies JPS maps to each port decides whether company_hub_code goes out. Asked only when there is
  // something to send, and cached, so a quiet sweep costs nothing.
  const portCatalog = eligible.length > 0 ? await fetchJpsPortCompanies() : null;
  // Which ports JPS knows: an STO of any other port is held with the reason instead of being refused (400, FAILED, never retried).
  const knownPorts = eligible.length > 0 ? await fetchJpsKnownPorts() : null;

  for (const sto of eligible) {
    const outcome = await submitOneSto(sto, portCatalog, knownPorts);
    if (outcome.kind === 'submitted') summary.submitted += 1;
    else if (outcome.kind === 'recovered') summary.recovered += 1;
    else if (outcome.kind === 'held') {
      summary.held += 1;
      if (outcome.listChanged) summary.listChanged += 1;
    } else if (outcome.kind === 'failed') {
      summary.failed += 1;
      if (outcome.listChanged) summary.listChanged += 1;
    }
  }

  return summary;
}
