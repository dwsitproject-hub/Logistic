/**
 * The history of calls KLIP makes to JPS, behind Integrations > JPS > History.
 *
 * Writing it must never change what a call does: every failure here is logged and swallowed, and nothing is recorded
 * under test. The API key is a header and is not part of a record.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';

export type JpsCallKind = 'submit' | 'amend' | 'poll' | 'recover' | 'test' | 'other';

export const JPS_CALL_KINDS: readonly JpsCallKind[] = ['submit', 'amend', 'poll', 'recover', 'test', 'other'];

/** What the caller knows about a call that the request alone does not say. */
export interface JpsCallContext {
  stoKey?: string | null;
  kind?: JpsCallKind;
}

export interface JpsCallRecord {
  kind: JpsCallKind;
  method: string;
  url: string;
  stoKey: string | null;
  externalReference: string | null;
  requestParams: unknown;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  durationMs: number;
}

export const JPS_CALL_LOG_RETENTION_DAYS = 30;
const MAX_JSON_CHARS = 32_000;
const PRUNE_EVERY = 200;
let writes = 0;

/**
 * JSON for a jsonb column. A body over the cap is stored as a marker with the start of the text rather than dropped,
 * so the history still shows that a large body was sent and how it began.
 */
export function boundJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
  if (text === undefined) return null;
  if (text.length <= MAX_JSON_CHARS) return text;
  return JSON.stringify({ truncated: true, chars: text.length, preview: text.slice(0, MAX_JSON_CHARS) });
}

/** The kind of a call from its shape, for callers that did not say. */
export function inferJpsCallKind(method: string | undefined, url: string | undefined): JpsCallKind {
  const m = String(method ?? 'GET').toUpperCase();
  const u = String(url ?? '');
  if (m === 'POST' && u === '/shipping-instructions') return 'submit';
  if (m === 'PATCH' && u.startsWith('/shipping-instructions')) return 'amend';
  if (m === 'GET' && /^\/shipping-instructions\/\d+/.test(u)) return 'poll';
  if (m === 'GET' && u === '/shipping-instructions') return 'recover';
  if (m === 'GET' && u === '/terms') return 'test';
  return 'other';
}

/** `KLIP-<sto>-R<n>` back to the STO key, for a call that carries only the reference. */
export function stoKeyFromReference(reference: unknown): string | null {
  const m = /^KLIP-(.+)-R\d+$/.exec(String(reference ?? '').trim());
  return m ? m[1] : null;
}

export async function recordJpsCall(record: JpsCallRecord): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await query(
      `INSERT INTO jps_api_calls (
         kind, method, url, sto_key, external_reference, request_params, request_body,
         response_status, response_body, ok, error_code, error_message, request_id, duration_ms
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14)`,
      [
        record.kind,
        record.method.toUpperCase(),
        record.url,
        record.stoKey,
        record.externalReference,
        boundJson(record.requestParams),
        boundJson(record.requestBody),
        record.responseStatus,
        boundJson(record.responseBody),
        record.ok,
        record.errorCode,
        record.errorMessage,
        record.requestId,
        record.durationMs,
      ],
    );
    writes += 1;
    // First write after a start, then every PRUNE_EVERY: cheap, and no cron to forget.
    if (writes % PRUNE_EVERY === 1) {
      await query(`DELETE FROM jps_api_calls WHERE created_at < NOW() - ($1::int || ' days')::interval`, [
        JPS_CALL_LOG_RETENTION_DAYS,
      ]);
    }
  } catch (error) {
    logger.warn('JPS call history could not be written', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
