import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import logger from '../utils/logger';

export interface OidcDiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcIdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
}

export interface OidcConfig {
  discoveryUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
}

let cachedDiscovery: OidcDiscoveryMetadata | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUri: string | null = null;

export function isOidcConfigured(): boolean {
  return Boolean(
    process.env.OIDC_DISCOVERY_URL?.trim() &&
      process.env.OIDC_CLIENT_ID?.trim() &&
      process.env.OIDC_REDIRECT_URI?.trim(),
  );
}

export function getOidcConfig(): OidcConfig {
  return {
    discoveryUrl: String(process.env.OIDC_DISCOVERY_URL).trim(),
    clientId: String(process.env.OIDC_CLIENT_ID).trim(),
    redirectUri: String(process.env.OIDC_REDIRECT_URI).trim(),
    scopes: String(process.env.OIDC_SCOPES || 'openid email profile').trim(),
  };
}

export async function fetchDiscoveryMetadata(forceRefresh = false): Promise<OidcDiscoveryMetadata> {
  if (cachedDiscovery && !forceRefresh) return cachedDiscovery;

  const { discoveryUrl } = getOidcConfig();
  const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status})`);
  }
  const body = (await response.json()) as Partial<OidcDiscoveryMetadata>;
  if (!body.issuer || !body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
    throw new Error('OIDC discovery document missing required fields');
  }
  cachedDiscovery = {
    issuer: body.issuer,
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    jwks_uri: body.jwks_uri,
  };
  return cachedDiscovery;
}

function getJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks && cachedJwksUri === jwksUri) return cachedJwks;
  cachedJwks = createRemoteJWKSet(new URL(jwksUri));
  cachedJwksUri = jwksUri;
  return cachedJwks;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateOidcState(): string {
  return base64UrlEncode(crypto.randomBytes(24));
}

export function generateOidcNonce(): string {
  return base64UrlEncode(crypto.randomBytes(24));
}

export function buildAuthorizeUrl(params: {
  metadata: OidcDiscoveryMetadata;
  config: OidcConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.metadata.authorization_endpoint);
  url.searchParams.set('client_id', params.config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.config.redirectUri);
  url.searchParams.set('scope', params.config.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<{ idToken: string; accessToken?: string }> {
  const config = getOidcConfig();
  const metadata = await fetchDiscoveryMetadata();

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: params.codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  if (!response.ok) {
    logger.warn('OIDC token exchange failed', { status: response.status, body: text.slice(0, 500) });
    throw new Error(`OIDC token exchange failed (${response.status}): ${text.slice(0, 200)}`);
  }

  let body: { id_token?: string; access_token?: string };
  try {
    body = JSON.parse(text) as { id_token?: string; access_token?: string };
  } catch {
    throw new Error('OIDC token endpoint returned non-JSON response');
  }

  if (!body.id_token) {
    throw new Error('OIDC token response missing id_token');
  }

  return { idToken: body.id_token, accessToken: body.access_token };
}

export async function verifyIdToken(
  idToken: string,
  expectedNonce?: string,
): Promise<OidcIdTokenClaims> {
  const config = getOidcConfig();
  const metadata = await fetchDiscoveryMetadata();
  const jwks = getJwks(metadata.jwks_uri);

  const result = await jwtVerify(idToken, jwks, {
    issuer: metadata.issuer,
    audience: config.clientId,
  });

  if (expectedNonce) {
    const tokenNonce = typeof result.payload.nonce === 'string' ? result.payload.nonce : '';
    if (tokenNonce !== expectedNonce) {
      throw new Error('OIDC id_token nonce mismatch');
    }
  }

  const sub = typeof result.payload.sub === 'string' ? result.payload.sub.trim() : '';
  if (!sub) {
    throw new Error('OIDC id_token missing sub claim');
  }

  const email =
    typeof result.payload.email === 'string' ? result.payload.email.trim().toLowerCase() : undefined;

  return {
    sub,
    email,
    name: typeof result.payload.name === 'string' ? result.payload.name : undefined,
  };
}

/** Test helper — reset cached discovery/JWKS between tests. */
export function resetOidcCacheForTests(): void {
  cachedDiscovery = null;
  cachedJwks = null;
  cachedJwksUri = null;
}
