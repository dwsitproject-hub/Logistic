import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import logger from '../utils/logger';
import { isJpsEnabled, jpsApiKey, jpsBaseUrl, jpsRequestTimeoutMs } from './config';
import type { JpsErrorDetail, JpsResult } from './types';

let cached: AxiosInstance | null = null;

export function resetJpsHttpForTests(): void {
  cached = null;
}

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

export async function jpsRequest<T>(config: AxiosRequestConfig): Promise<JpsResult<T>> {
  if (!isJpsEnabled()) {
    return {
      ok: false,
      status: 0,
      code: 'JPS_DISABLED',
      message: 'JPS integration is not enabled',
      retryable: false,
    };
  }

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
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'request failed',
      retryable: true,
    };
  }

  const body = res.data ?? {};
  if (res.status >= 200 && res.status < 300 && body.success !== false) {
    return { ok: true, status: res.status, data: body.data as T };
  }

  return {
    ok: false,
    status: res.status,
    code: String(body.error?.code || `HTTP_${res.status}`),
    message: String(body.error?.message || `JPS returned ${res.status}`),
    details: body.error?.details,
    requestId: body.request_id,
    retryable: isRetryable(res.status),
  };
}
