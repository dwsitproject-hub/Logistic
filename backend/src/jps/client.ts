import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import logger from '../utils/logger';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import {
  inferJpsCallKind,
  recordJpsCall,
  stoKeyFromReference,
  type JpsCallContext,
  type JpsCallRecord,
} from './callLog';
import { isJpsEnabled, jpsApiKey, jpsBaseUrl, jpsRequestTimeoutMs } from './config';
import type { JpsErrorDetail, JpsResult } from './types';

let cached: AxiosInstance | null = null;

export function resetJpsHttpForTests(): void {
  cached = null;
}

// The cached instance carries the base URL and timeout; a saved change must reach the next call.
onIntegrationSettingsChanged(resetJpsHttpForTests);

function jpsHttp(): AxiosInstance {
  if (cached) return cached;
  cached = axios.create({
    baseURL: jpsBaseUrl(),
    timeout: jpsRequestTimeoutMs(),
    // Every status is a result, not an exception: 409 on submit means "already there" and is
    // recoverable, so the caller has to see the code rather than a thrown error.
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' },
  });
  return cached;
}

/**
 * Only 429 and 5xx are worth retrying. The partner API is explicit that 400/401/404/409 are
 * permanent - retrying a 400 just burns the rate limit and delays the real fix.
 */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

type Envelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: JpsErrorDetail[] };
  request_id?: string;
};

/**
 * `requireEnabled: false` is for the Integrations menu's connection test only: an ADMIN checks a
 * new key before switching the integration on. Every sweep, submit and poll keeps the default.
 */
export async function jpsRequest<T>(
  config: AxiosRequestConfig,
  options: { requireEnabled?: boolean; audit?: JpsCallContext } = {},
): Promise<JpsResult<T>> {
  const requireEnabled = options.requireEnabled ?? true;
  if (!requireEnabled && (!jpsBaseUrl() || !jpsApiKey())) {
    return {
      ok: false,
      status: 0,
      code: 'JPS_NOT_CONFIGURED',
      message: 'JPS base URL or API key is not set',
      retryable: false,
    };
  }
  if (requireEnabled && !isJpsEnabled()) {
    return {
      ok: false,
      status: 0,
      code: 'JPS_DISABLED',
      message: 'JPS integration is not enabled',
      retryable: false,
    };
  }

  const startedAt = Date.now();
  // What goes into the history (Integrations > JPS > History). Recording never changes the result, and a call that
  // was not made (disabled, not configured) is not a call.
  const record = (result: JpsResult<T>, responseBody: unknown): void => {
    const method = String(config.method ?? 'GET').toUpperCase();
    const url = String(config.url ?? '');
    const sent = (config.data ?? null) as { external_reference?: unknown } | null;
    const params = config.params as { external_reference?: unknown } | undefined;
    const reference = sent?.external_reference ?? params?.external_reference;
    const entry: JpsCallRecord = {
      kind: options.audit?.kind ?? inferJpsCallKind(method, url),
      method,
      url,
      stoKey: options.audit?.stoKey ?? stoKeyFromReference(reference),
      externalReference: reference ? String(reference) : null,
      requestParams: config.params ?? null,
      requestBody: config.data ?? null,
      responseStatus: result.status,
      responseBody,
      ok: result.ok,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message,
      requestId: result.ok ? null : result.requestId ?? null,
      durationMs: Date.now() - startedAt,
    };
    void recordJpsCall(entry);
  };

  let res;
  try {
    res = await jpsHttp().request<Envelope<T>>({
      ...config,
      headers: { ...(config.headers ?? {}), 'x-api-key': jpsApiKey() },
    });
  } catch (error) {
    // A timeout or a refused connection is transient by nature - the instruction may or may not
    // have been created, which is exactly what external_reference exists to resolve on retry.
    logger.warn('JPS request failed to complete', {
      url: config.url,
      error: error instanceof Error ? error.message : String(error),
    });
    const failed: JpsResult<T> = {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'request failed',
      retryable: true,
    };
    record(failed, null);
    return failed;
  }

  const body = res.data ?? {};
  if (res.status >= 200 && res.status < 300 && body.success !== false) {
    const done: JpsResult<T> = { ok: true, status: res.status, data: body.data as T };
    record(done, res.data ?? null);
    return done;
  }

  const failed: JpsResult<T> = {
    ok: false,
    status: res.status,
    code: String(body.error?.code || `HTTP_${res.status}`),
    message: String(body.error?.message || `JPS returned ${res.status}`),
    details: body.error?.details,
    requestId: body.request_id,
    retryable: isRetryable(res.status),
  };
  record(failed, res.data ?? null);
  return failed;
}
