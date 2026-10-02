/**
 * What is specific to the JPS side of the call history (Integrations > JPS > History): the kinds, how a call is named
 * from its request, and the mapping onto the shared recorder in integrations/apiCallLog.ts.
 */
import { boundJson, recordApiCall } from '../integrations/apiCallLog';

export { boundJson };

export type JpsCallKind = 'submit' | 'amend' | 'poll' | 'recover' | 'test' | 'webhook' | 'other';

export const JPS_CALL_KINDS: readonly JpsCallKind[] = ['submit', 'amend', 'poll', 'recover', 'test', 'webhook', 'other'];

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
  await recordApiCall('jps', {
    kind: record.kind,
    method: record.method,
    url: record.url,
    subject: record.stoKey,
    reference: record.externalReference,
    requestParams: record.requestParams,
    requestBody: record.requestBody,
    responseStatus: record.responseStatus,
    responseBody: record.responseBody,
    ok: record.ok,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    requestId: record.requestId,
    durationMs: record.durationMs,
  });
}
