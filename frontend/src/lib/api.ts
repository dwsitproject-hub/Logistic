import axios from 'axios';
import { clearClientDataCache } from '@/lib/clientDataCache';
import { mapHttpMethodToEventType, trackApiMutation } from '@/lib/userActivityTracker';

const DEFAULT_API_BASE = 'http://127.0.0.1:5001/api';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE,
});

// Add token to requests
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
    // Enhanced error logging for debugging
    if (typeof window !== 'undefined') {
      const baseURL = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE;
      
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        console.error('❌ Network Error: Cannot connect to backend API');
        console.error('   API URL:', baseURL);
        console.error('   Make sure backend is running on port 5001');
        console.error('   Test: http://127.0.0.1:5001/health');
        if (baseURL.includes('localhost')) {
          console.error('   Tip: On Windows, use http://127.0.0.1:5001/api instead of localhost');
        }
      } else if (error.response) {
        // Server responded with error status
        const { status, data } = error.response;
        console.error(`❌ API Error [${status}]:`, {
          url: error.config?.url,
          method: error.config?.method,
          message: data?.error?.message || data?.message || 'Unknown error',
          data: data
        });
      } else {
        console.error('❌ Request Error:', error.message);
      }
    }

    // Treat 401 or 403 (invalid/expired token) as "need to re-login"
    const status = error.response?.status;
    const message = error.response?.data?.error?.message || '';
    const requestUrl = String(error.config?.url || '');
    const isLoginAttempt = requestUrl.includes('/auth/login');
    const isAuthFailure =
      status === 401 || (status === 403 && (message.includes('token') || message.includes('expired')));
    // Do not hard-redirect on failed login — login page must show the error message.
    if (isAuthFailure && !isLoginAttempt && typeof window !== 'undefined') {
      clearClientDataCache();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export { api };
export default api;

