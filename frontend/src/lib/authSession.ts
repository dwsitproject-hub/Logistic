import api from '@/lib/api';
import { hubIdentify, hubReset } from '@/lib/hubSdk';

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
  /** Downstream Hub user id (OIDC `sub`); null for users who never signed in through the Hub. */
  hub_user_id?: string | null;
};

export type LoginOptions = {
  localLogin: boolean;
  hubSso: boolean;
};

const DEFAULT_LOGIN_OPTIONS: LoginOptions = {
  localLogin: true,
  hubSso: false,
};

/**
 * Every path that learns who is signed in comes through here — local login, the SSO callback,
 * and <Layout>'s /auth/me check on each page — so this is where the Hub SDK is told. A no-op
 * unless the SDK is configured.
 */
export function storeUserLocally(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('user', JSON.stringify(user));
  hubIdentify(user);
}

/**
 * The user a <Layout> starts with. On the server, and on the render that HYDRATES the server HTML, it has to be null: the server has no localStorage
 * and renders "Loading...", so a client that starts with the cached user renders the whole shell instead - React throws #418, then #423, and replaces
 * the server HTML with a client render of the entire root. Only a Layout that mounts after the app has hydrated (a route change, which hydrates
 * nothing) may read the cache synchronously, which is what keeps the shell from flashing "Loading..." between pages.
 */
export function initialSessionUser(appHydrated: boolean): AuthUser | null {
  if (typeof window === 'undefined' || !appHydrated) return null;
  return readUserLocally();
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

/**
 * Every sign-out path comes through here (logout, an expired session, no access), so this is where
 * the Hub SDK forgets the user — otherwise the next person on the same browser would inherit this
 * one's session and their bug reports would carry this one's activity. A no-op unless configured.
 */
export function clearLocalAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  hubReset();
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
