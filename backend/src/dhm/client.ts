import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import logger from '../utils/logger';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import { recordDhmCall, redactedAuthRequest } from './callLog';
import {
  dhmBaseUrl,
  dhmPrivateKey,
  dhmPublicKey,
  dhmRequestTimeoutMs,
  isDhmEnabled,
} from './config';

let cached: AxiosInstance | null = null;
let tokenCache: { token: string; expiresAt: number } | null = null;

const TOKEN_REFRESH_MS = 7 * 60 * 60 * 1000;

export function resetDhmHttpForTests(): void {
  cached = null;
  tokenCache = null;
}

/*
 * A rotated key or a new base URL must take effect on the next request, not when the seven-hour
 * token happens to expire. The Integrations menu publishes every save through integrationEnv.
 */
onIntegrationSettingsChanged(resetDhmHttpForTests);

/**
 * DHM's own reason for turning a token request down, for the error message.
 *
 * The status alone - "401" - says only that the pair was refused, which is where every cause looks
 * the same. DHM's body says which: missing credentials, unknown key, inactive application. An HTML
 * body is its own answer: the base URL reached the DHM PORTAL, not the API behind `/api`.
 *
 * Defensive about secrets even though DHM does not echo them: any dhm_sk_ token is masked, and the
 * text is capped.
 */
export function describeDhmRejection(body: unknown): string {
  if (typeof body === 'string') {
    if (/<!doctype html|<html/i.test(body)) {
      return ': the base URL answered with an HTML page - it looks like the DHM portal, not the API (the SIT base URL ends in /api)';
    }
    const text = body.trim();
    return text ? `: ${mask(text)}` : '';
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const reason = b.error ?? b.message;
    if (typeof reason === 'string' && reason.trim()) return `: ${mask(reason.trim())}`;
  }
  return '';
}

function mask(text: string): string {
  return text.replace(/dhm_sk_[A-Za-z0-9]+/g, 'dhm_sk_***').slice(0, 200);
}

async function fetchDhmBearerToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  // The token request is recorded in the call history like any other, but with the private key replaced and a
  // successful answer reduced to a placeholder (dhm/callLog.ts): "DHM token failed (401)" is what an ADMIN traces.
  const startedAt = Date.now();
  const authRecord = {
    method: 'POST',
    url: '/auth/token',
    requestBody: null,
    auth: { requestBody: redactedAuthRequest(dhmPublicKey()), responseBody: null as unknown },
  };
  let res;
  try {
    res = await axios.post<{ token?: string }>(
      `${dhmBaseUrl()}/auth/token`,
      { publicKey: dhmPublicKey(), privateKey: dhmPrivateKey() },
      {
        timeout: dhmRequestTimeoutMs(),
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    void recordDhmCall({
      ...authRecord,
      responseStatus: 0,
      responseBody: null,
      ok: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: error instanceof Error ? error.message : 'request failed',
      requestId: null,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
  const token = res.status === 200 ? String(res.data?.token || '').trim() : '';
  void recordDhmCall({
    ...authRecord,
    auth: { ...authRecord.auth, responseBody: token ? { token: '***' } : res.data ?? null },
    responseStatus: res.status,
    responseBody: null,
    ok: Boolean(token),
    errorCode: token ? null : `HTTP_${res.status}`,
    errorMessage: token ? null : `DHM token failed (${res.status})${describeDhmRejection(res.data)}`,
    requestId: null,
    durationMs: Date.now() - startedAt,
  });
  if (!token) {
    throw new Error(`DHM token failed (${res.status})${describeDhmRejection(res.data)}`);
  }
  tokenCache = { token, expiresAt: Date.now() + TOKEN_REFRESH_MS };
  return token;
}

/**
 * Can KLIP authenticate with DHM using the credentials it would use right now?
 *
 * Asks for a fresh token rather than reusing the cached one - a cached token proves only that
 * the OLD credentials once worked. Does not require DHM_ENABLED, so an ADMIN can check a new key
 * before switching the integration on. Never returns the token.
 */
export async function verifyDhmCredentials(): Promise<{ ok: boolean; message: string }> {
  if (!dhmBaseUrl()) return { ok: false, message: 'Base URL is not set.' };
  if (!dhmPublicKey() || !dhmPrivateKey()) return { ok: false, message: 'Public or private key is not set.' };
  tokenCache = null;
  /*
   * Say exactly what was sent, so "is KLIP sending what I typed?" has an answer on the page. The
   * public key is public; the private key appears only as its hint.
   */
  const pub = dhmPublicKey();
  const priv = dhmPrivateKey();
  const sent = ` [${dhmBaseUrl()}/auth/token - public ${pub.slice(0, 7)}...${pub.slice(-4)} (${pub.length}), private ${priv.slice(0, 7)}...${priv.slice(-4)} (${priv.length})]`;
  try {
    await fetchDhmBearerToken();
    return { ok: true, message: `Authenticated - DHM issued a token.${sent}` };
  } catch (error) {
    tokenCache = null;
    return { ok: false, message: `${error instanceof Error ? error.message : 'DHM request failed.'}${sent}` };
  }
}

export function dhmHttp(): AxiosInstance {
  if (cached) return cached;
  cached = axios.create({
    baseURL: dhmBaseUrl(),
    timeout: dhmRequestTimeoutMs(),
    validateStatus: () => true,
  });
  cached.interceptors.request.use(async (config) => {
    const url = String(config.url || '');
    if (url.includes('/auth/token')) return config;
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${await fetchDhmBearerToken()}`;
    return config;
  });
  return cached;
}

async function withGetRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      tokenCache = null;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw last;
}

export async function dhmRequest<T = unknown>(
  config: AxiosRequestConfig,
): Promise<{ status: number; data: T }> {
  if (!isDhmEnabled()) {
    throw new Error('DHM is not enabled');
  }
  const method = String(config.method || 'get').toLowerCase();
  const run = async () => {
    const startedAt = Date.now();
    const verb = method.toUpperCase();
    const url = String(config.url || '');
    try {
      const res = await dhmHttp().request<T>(config);
      if (res.status === 401) tokenCache = null;
      const ok = res.status >= 200 && res.status < 300;
      // Every attempt is recorded, a retried read included: three failures in a row are the point of the history.
      void recordDhmCall({
        method: verb,
        url,
        requestBody: config.data ?? null,
        responseStatus: res.status,
        responseBody: res.data ?? null,
        ok,
        errorCode: ok ? null : `HTTP_${res.status}`,
        errorMessage: ok ? null : describeDhmRejection(res.data).replace(/^: /, '') || null,
        requestId: String(res.headers?.['x-request-id'] ?? '') || null,
        durationMs: Date.now() - startedAt,
      });
      return { status: res.status, data: res.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A token request that failed has its own record, with DHM's answer; do not add a second without one.
      if (!message.startsWith('DHM token failed')) {
        void recordDhmCall({
          method: verb,
          url,
          requestBody: config.data ?? null,
          responseStatus: 0,
          responseBody: null,
          ok: false,
          errorCode: 'NETWORK_ERROR',
          errorMessage: message,
          requestId: null,
          durationMs: Date.now() - startedAt,
        });
      }
      throw error;
    }
  };
  if (method === 'get') {
    return withGetRetry(run);
  }
  try {
    return await run();
  } catch (error) {
    logger.warn('DHM request failed', { url: config.url, error });
    throw error;
  }
}
