/**
 * The history of calls KLIP makes to another system, behind Integrations > (JPS | DHM) > History.
 *
 * One recorder for both integrations, each with its own table (jps_api_calls, dhm_api_calls). The two differ only in
 * what names a call: JPS has an STO key and an external reference, DHM a slug and a record code. Both are kept in
 * `subject` / `reference` here and mapped to the right columns below, so the list and detail endpoints and the page
 * are shared.
 *
 * Writing it must never change what a call does: every failure is logged and swallowed, and nothing is recorded under
 * test. Credentials are not part of a record: the caller redacts bodies before they get here (DHM) or never has them in
 * a body (JPS sends its key in a header).
 */
import { query } from '../database/connection';
import logger from '../utils/logger';

export type ApiCallIntegration = 'jps' | 'dhm';

interface CallTable {
  table: string;
  /** Column that names what the call is about: the STO key (JPS) or the slug (DHM). */
  subject: string;
  /** Column that holds the reference: the external reference (JPS) or the record code (DHM). */
  reference: string;
}

/** A fixed map, never built from input: the names below go straight into SQL. */
export const API_CALL_TABLES: Record<ApiCallIntegration, CallTable> = {
  jps: { table: 'jps_api_calls', subject: 'sto_key', reference: 'external_reference' },
  dhm: { table: 'dhm_api_calls', subject: 'slug', reference: 'code' },
};

export function isApiCallIntegration(value: unknown): value is ApiCallIntegration {
  return value === 'jps' || value === 'dhm';
}

export interface ApiCallRecord {
  kind: string;
  method: string;
  url: string;
  subject: string | null;
  reference: string | null;
  requestParams: unknown;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  durationMs: number;
  /** A smaller cap for the response body, for calls whose answer is large and unremarkable (a sync page). */
  responseMaxChars?: number;
}

export const API_CALL_RETENTION_DAYS = 30;
export const MAX_JSON_CHARS = 32_000;
const PRUNE_EVERY = 200;
const writes: Record<ApiCallIntegration, number> = { jps: 0, dhm: 0 };

/**
 * JSON for a jsonb column. A body over the cap is stored as a marker with the start of the text rather than dropped,
 * so the history still shows that a large body was sent and how it began.
 */
export function boundJson(value: unknown, maxChars: number = MAX_JSON_CHARS): string | null {
  if (value === undefined || value === null) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
  if (text === undefined) return null;
  if (text.length <= maxChars) return text;
  return JSON.stringify({ truncated: true, chars: text.length, preview: text.slice(0, maxChars) });
}

export async function recordApiCall(integration: ApiCallIntegration, record: ApiCallRecord): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const t = API_CALL_TABLES[integration];
  try {
    await query(
      `INSERT INTO ${t.table} (
         kind, method, url, ${t.subject}, ${t.reference}, request_params, request_body,
         response_status, response_body, ok, error_code, error_message, request_id, duration_ms
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14)`,
      [
        record.kind,
        record.method.toUpperCase(),
        record.url,
        record.subject,
        record.reference,
        boundJson(record.requestParams),
        boundJson(record.requestBody),
        record.responseStatus,
        boundJson(record.responseBody, record.responseMaxChars ?? MAX_JSON_CHARS),
        record.ok,
        record.errorCode,
        record.errorMessage,
        record.requestId,
        record.durationMs,
      ],
    );
    writes[integration] += 1;
    // First write after a start, then every PRUNE_EVERY: cheap, and no cron to forget.
    if (writes[integration] % PRUNE_EVERY === 1) {
      await query(`DELETE FROM ${t.table} WHERE created_at < NOW() - ($1::int || ' days')::interval`, [
        API_CALL_RETENTION_DAYS,
      ]);
    }
  } catch (error) {
    logger.warn(`${integration.toUpperCase()} call history could not be written`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
