/**
 * What is specific to the DHM side of the call history (Integrations > DHM > History): how a call is named from its
 * URL, and the redaction every body goes through before it is stored.
 *
 * The one call that carries a secret is the token request (`POST /auth/token`, body `{ publicKey, privateKey }`). It is
 * recorded, because "DHM token failed (401)" is exactly what an ADMIN wants to trace, but with the private key replaced
 * and a successful answer reduced to `{ token: '***' }`. Every other body also goes through maskSecrets, on the chance
 * that a key shows up where it should not.
 */
import { recordApiCall } from '../integrations/apiCallLog';

export type DhmCallKind = 'auth' | 'push' | 'sync' | 'catalog' | 'lookup' | 'other';

export const DHM_CALL_KINDS: readonly DhmCallKind[] = ['auth', 'push', 'sync', 'catalog', 'lookup', 'other'];

export interface DhmCallInfo {
  kind: DhmCallKind;
  slug: string | null;
  code: string | null;
  /** The query string of a sync call, as an object, so it reads as parameters rather than as part of the URL. */
  params: Record<string, string> | null;
  /** The path without the query string. */
  path: string;
}

/** Name a DHM call from its method and URL. */
export function describeDhmCall(method: string | undefined, url: string | undefined): DhmCallInfo {
  const raw = String(url ?? '');
  const [path, query = ''] = raw.split('?', 2);
  const params = query ? Object.fromEntries(new URLSearchParams(query).entries()) : null;
  const m = String(method ?? 'GET').toUpperCase();
  const decode = (s: string | undefined): string | null => {
    if (!s) return null;
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  let hit = /^\/v1\/inbound\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (hit && (m === 'POST' || m === 'PUT')) {
    return { kind: 'push', slug: hit[1], code: decode(hit[2]), params, path };
  }
  hit = /^\/v1\/sync\/([^/]+)$/.exec(path);
  if (hit && m === 'GET') return { kind: 'sync', slug: hit[1], code: null, params, path };
  if (m === 'GET' && path === '/v1/catalog') return { kind: 'catalog', slug: null, code: null, params, path };
  hit = /^\/v1\/lookup\/([^/]+)\/(.+)$/.exec(path);
  if (hit && m === 'GET') return { kind: 'lookup', slug: hit[1], code: decode(hit[2]), params, path };
  if (m === 'POST' && path.endsWith('/auth/token')) return { kind: 'auth', slug: null, code: null, params, path };
  return { kind: 'other', slug: null, code: null, params, path };
}

/** A dhm_sk_ key anywhere in a value becomes dhm_sk_***. */
export function maskSecrets<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value).replace(/dhm_sk_[A-Za-z0-9]+/g, 'dhm_sk_***')) as T;
  } catch {
    return value;
  }
}

/** The token request as it is stored: the public key as its hint, the private key never. */
export function redactedAuthRequest(publicKey: string): { publicKey: string; privateKey: string } {
  const hint = publicKey.length > 11 ? `${publicKey.slice(0, 7)}...${publicKey.slice(-4)}` : '***';
  return { publicKey: `${hint} (${publicKey.length})`, privateKey: '***' };
}

export interface DhmCallRecord {
  method: string;
  url: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  durationMs: number;
  /** For the token request: what to store instead of the raw bodies. */
  auth?: { requestBody: unknown; responseBody: unknown };
}

/** A successful read answers with a page of records, and the same page every sync: keep only its start. */
const READ_RESPONSE_PREVIEW_CHARS = 2_000;

export async function recordDhmCall(record: DhmCallRecord): Promise<void> {
  const info = describeDhmCall(record.method, record.url);
  const readOk = record.ok && record.method.toUpperCase() === 'GET';
  await recordApiCall('dhm', {
    kind: info.kind,
    method: record.method,
    url: info.path,
    subject: info.slug,
    reference: info.code,
    requestParams: info.params,
    requestBody: record.auth ? record.auth.requestBody : maskSecrets(record.requestBody),
    responseStatus: record.responseStatus,
    responseBody: maskSecrets(record.auth ? record.auth.responseBody : record.responseBody),
    ok: record.ok,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage ? maskSecrets(record.errorMessage) : null,
    requestId: record.requestId,
    durationMs: record.durationMs,
    responseMaxChars: readOk ? READ_RESPONSE_PREVIEW_CHARS : undefined,
  });
}
