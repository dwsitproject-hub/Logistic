import { isOidcConfigured } from '../services/oidc.service';

/** Local username/password login (default on — SSO is additive, not a replacement). */
export function isLocalLoginEnabled(): boolean {
  const value = String(process.env.LOCAL_LOGIN_ENABLED ?? 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'no';
}

export function getAuthLoginOptions(): { localLogin: boolean; hubSso: boolean } {
  return {
    localLogin: isLocalLoginEnabled(),
    hubSso: isOidcConfigured(),
  };
}
