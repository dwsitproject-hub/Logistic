import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getAuthLoginOptions, isLocalLoginEnabled } from './authConfig';

describe('authConfig', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = env;
  });

  it('enables local login by default', () => {
    delete process.env.LOCAL_LOGIN_ENABLED;
    expect(isLocalLoginEnabled()).toBe(true);
  });

  it('disables local login only when LOCAL_LOGIN_ENABLED=false', () => {
    process.env.LOCAL_LOGIN_ENABLED = 'false';
    expect(isLocalLoginEnabled()).toBe(false);
  });

  it('reports both paths when OIDC env is set', () => {
    process.env.LOCAL_LOGIN_ENABLED = 'true';
    process.env.OIDC_DISCOVERY_URL = 'http://hub.example/.well-known/openid-configuration';
    process.env.OIDC_CLIENT_ID = 'logistic';
    process.env.OIDC_REDIRECT_URI = 'http://klip.example/auth/oidc/callback';
    expect(getAuthLoginOptions()).toEqual({ localLogin: true, hubSso: true });
  });
});
