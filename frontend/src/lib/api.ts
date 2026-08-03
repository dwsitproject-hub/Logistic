import axios from 'axios';
import { clearClientDataCache } from '@/lib/clientDataCache';
import { clearLocalAuth, isAuthenticatedLocally } from '@/lib/authSession';
import { mapHttpMethodToEventType, trackApiMutation } from '@/lib/userActivityTracker';

const DEFAULT_API_BASE = 'http://127.0.0.1:5001/api';

function isLocalDevFrontendHost(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, port } = window.location;
  return (
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    (port === '3001' || port === '')
  );
}

/**
 * Resolve API base URL for axios.
 * - Staging/production: relative `/api` (nginx same-origin proxy).
 * - Local dev (localhost:3001, no nginx): direct backend on :5001.
 * - Misconfigured absolute backend IP in browser build: fall back to `/api` on non-local hosts.
 */
export function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE;
  if (typeof window === 'undefined') return configured;

  if (configured.startsWith('/')) {
    if (isLocalDevFrontendHost()) {
      return DEFAULT_API_BASE;
    }
    return configured;
  }

  try {
    const apiHost = new URL(configured, window.location.origin).host;
    if (apiHost !== window.location.host) {
      if (isLocalDevFrontendHost()) {
        return DEFAULT_API_BASE;
      }
      console.warn(
        '[KLIP] API base points to a different host; using same-origin /api instead of',
        configured,
      );
      return '/api';
    }
  } catch {
    /* use configured */
  }
  return configured;
}

const configuredBase = resolveApiBaseUrl();

const api = axios.create({
  baseURL: configuredBase,
  withCredentials: true,
});

function isExpectedAnonymous401(status: number | undefined, requestUrl: string): boolean {
  if (status !== 401) return false;
  return (
    requestUrl.includes('/auth/me') ||
    requestUrl.includes('/auth/login-options') ||
    requestUrl.includes('/user-activity/')
  );
}

// Add Bearer token when present (legacy / transitional); cookie sessions use withCredentials.
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const method = config.method || 'get';
    const eventType = mapHttpMethodToEventType(method);
    if (eventType && config.url) {
      const label = `${method.toUpperCase()} ${config.url}`;
      trackApiMutation(method, config.url, eventType, label);
    }
  }
  return config;
});

// Handle token expiration and improve error logging
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl = String(error.config?.url || '');

    // Enhanced error logging for debugging
    if (typeof window !== 'undefined' && !isExpectedAnonymous401(status, requestUrl)) {
      const baseURL = configuredBase;

      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        console.error('❌ Network Error: Cannot connect to backend API');
        console.error('   API URL:', baseURL);
        console.error('   Make sure backend is running on port 5001');
        console.error('   Test: http://127.0.0.1:5001/health');
        if (baseURL.includes('localhost')) {
          console.error('   Tip: On Windows, use http://127.0.0.1:5001/api instead of localhost');
        }
      } else if (error.response) {
        const { data } = error.response;
        console.error(`❌ API Error [${status}]:`, {
          url: error.config?.url,
          method: error.config?.method,
          message: data?.error?.message || data?.message || 'Unknown error',
          data: data,
        });
      } else {
        console.error('❌ Request Error:', error.message);
      }
    }

    // Treat 401 or 403 (invalid/expired token) as "need to re-login"
    const message = error.response?.data?.error?.message || '';
    const isLoginAttempt = requestUrl.includes('/auth/login');
    const isAuthFailure =
      status === 401 || (status === 403 && (message.includes('token') || message.includes('expired')));
    const onLoginPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/login');
    // Do not hard-redirect on failed login — login page must show the error message.
    if (isAuthFailure && !isLoginAttempt && !onLoginPage && typeof window !== 'undefined') {
      if (isAuthenticatedLocally()) {
        clearClientDataCache();
        clearLocalAuth();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export { api };
export default api;
