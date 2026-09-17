import api from '@/lib/api';

export type AuthUser = {
  id?: string;
  username?: string;
  email?: string;
  full_name?: string;
  role?: string;
  level?: string | null;
  transport_type?: string | null;
  group_plants?: string[];
  products?: string[];
  is_first_login?: boolean;
};

export type LoginOptions = {
  localLogin: boolean;
  hubSso: boolean;
};

const DEFAULT_LOGIN_OPTIONS: LoginOptions = {
  localLogin: true,
  hubSso: false,
};

export function storeUserLocally(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('user', JSON.stringify(user));
}

export function readUserLocally(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const userData = localStorage.getItem('user');
    if (!userData) return null;
    return JSON.parse(userData) as AuthUser;
  } catch {
    return null;
  }
}

export function clearLocalAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function isAuthenticatedLocally(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem('user') || localStorage.getItem('token'));
}

export async function fetchLoginOptions(): Promise<LoginOptions> {
  try {
    const response = await api.get('/auth/login-options');
    const data = response.data?.data as LoginOptions | undefined;
    if (data && typeof data.localLogin === 'boolean' && typeof data.hubSso === 'boolean') {
      return data;
    }
  } catch {
    /* fall back — keep local login available */
  }
  return DEFAULT_LOGIN_OPTIONS;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await api.get('/auth/me');
    const user = response.data?.data as AuthUser | undefined;
    if (user?.id) {
      storeUserLocally(user);
      return user;
    }
    return null;
  } catch {
    return null;
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    /* session may already be gone */
  }
  clearLocalAuth();
}

export function startHubOidcLogin(): void {
  if (typeof window === 'undefined') return;
  window.location.href = '/auth/oidc/login';
}
