import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import logger from '../utils/logger';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
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

async function fetchDhmBearerToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await axios.post<{ token?: string }>(
    `${dhmBaseUrl()}/auth/token`,
    { publicKey: dhmPublicKey(), privateKey: dhmPrivateKey() },
    {
      timeout: dhmRequestTimeoutMs(),
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' },
    },
  );
  const token = res.status === 200 ? String(res.data?.token || '').trim() : '';
  if (!token) {
    throw new Error(`DHM token failed (${res.status})`);
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
  try {
    await fetchDhmBearerToken();
    return { ok: true, message: 'Authenticated - DHM issued a token.' };
  } catch (error) {
    tokenCache = null;
    return { ok: false, message: error instanceof Error ? error.message : 'DHM request failed.' };
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
    const res = await dhmHttp().request<T>(config);
    if (res.status === 401) tokenCache = null;
    return { status: res.status, data: res.data };
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
