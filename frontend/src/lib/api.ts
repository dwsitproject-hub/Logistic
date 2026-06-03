import axios from 'axios';

/** Same-origin /api uses Next.js rewrites → backend (local + port-forward safe). */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined') {
    return '/api';
  }
  return process.env.INTERNAL_API_URL || 'http://127.0.0.1:5001/api';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
});

// Add token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
      const baseURL = getApiBaseUrl();

      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        console.error('❌ Network Error: Cannot connect to backend API');
        console.error('   API URL:', baseURL);
        console.error('   Make sure backend is running on port 5001');
        console.error('   Test: http://127.0.0.1:5001/health or same-origin /api/health');
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
    const isAuthFailure = status === 401 || (status === 403 && (message.includes('token') || message.includes('expired')));
    if (isAuthFailure && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export { api };
export default api;
