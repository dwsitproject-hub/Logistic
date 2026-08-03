import { Request, Response } from 'express';
import logger from '../utils/logger';
import { AuditService } from '../services/audit.service';
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchDiscoveryMetadata,
  generateOidcNonce,
  generateOidcState,
  generatePkcePair,
  getOidcConfig,
  isOidcConfigured,
  verifyIdToken,
} from '../services/oidc.service';
import {
  establishSession,
  frontendUrl,
  loadActiveUserByEmail,
  persistHubOidcSub,
  saveSession,
} from '../services/sessionAuth.service';

function redirectLoginError(res: Response, errorCode: string): void {
  res.redirect(303, `${frontendUrl()}/login?error=${encodeURIComponent(errorCode)}`);
}

function oidcNotConfigured(_req: Request, res: Response): void {
  res.status(503).json({
    success: false,
    error: { message: 'OIDC SSO is not configured on this server' },
  });
}

/** GET /auth/oidc/login — SP-initiated login redirect to Hub. */
export const oidcLoginHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isOidcConfigured()) {
    oidcNotConfigured(req, res);
    return;
  }

  try {
    const metadata = await fetchDiscoveryMetadata();
    const config = getOidcConfig();
    const state = generateOidcState();
    const nonce = generateOidcNonce();
    const { codeVerifier, codeChallenge } = generatePkcePair();

    if (req.session) {
      req.session.oidcState = state;
      req.session.oidcNonce = nonce;
      req.session.oidcCodeVerifier = codeVerifier;
    }

    const authorizeUrl = buildAuthorizeUrl({
      metadata,
      config,
      state,
      nonce,
      codeChallenge,
    });
    await saveSession(req);
    res.redirect(302, authorizeUrl);
  } catch (error) {
    logger.error('OIDC login initiation failed', { error });
    redirectLoginError(res, 'sso_failed');
  }
};

/** GET /auth/oidc/callback — SP-initiated and IdP-initiated (Hub tile) flows. */
export const oidcCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  if (!isOidcConfigured()) {
    oidcNotConfigured(req, res);
    return;
  }

  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  if (oauthError) {
    logger.warn('OIDC callback OAuth error', {
      error: oauthError,
      description: req.query.error_description,
    });
    redirectLoginError(res, 'sso_failed');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    redirectLoginError(res, 'sso_failed');
    return;
  }

  try {
    const hubCodeVerifier =
      typeof req.query.code_verifier === 'string' ? req.query.code_verifier : '';
    const isIdpInitiated = Boolean(hubCodeVerifier);

    let codeVerifier: string;
    let expectedNonce: string | undefined;

    if (isIdpInitiated) {
      codeVerifier = hubCodeVerifier;
      expectedNonce = undefined;
    } else {
      const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
      const sessionState = req.session?.oidcState ?? '';
      if (!returnedState || !sessionState || returnedState !== sessionState) {
        logger.warn('OIDC callback state mismatch');
        redirectLoginError(res, 'sso_failed');
        return;
      }
      codeVerifier = req.session?.oidcCodeVerifier ?? '';
      expectedNonce = req.session?.oidcNonce;
      if (!codeVerifier) {
        redirectLoginError(res, 'sso_failed');
        return;
      }
    }

    const { idToken } = await exchangeAuthorizationCode({ code, codeVerifier });
    const claims = await verifyIdToken(idToken, expectedNonce);

    const email = claims.email?.trim().toLowerCase() ?? '';
    if (!email) {
      logger.warn('OIDC id_token missing email claim', { sub: claims.sub });
      redirectLoginError(res, 'sso_failed');
      return;
    }

    const userRow = await loadActiveUserByEmail(email);
    if (!userRow) {
      redirectLoginError(res, 'sso_no_access');
      return;
    }

    await persistHubOidcSub(String(userRow.id), claims.sub);

    await AuditService.log({
      userId: String(userRow.id),
      action: 'SSO_LOGIN',
      entityType: 'USER',
      entityId: String(userRow.id),
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.get('user-agent'),
    });

    establishSession(req, String(userRow.id));
    await saveSession(req);

    logger.info(`OIDC SSO login: user ${userRow.username} via Downstream Hub`);

    res.redirect(303, frontendUrl());
  } catch (error) {
    logger.error('OIDC callback failed', { error });
    redirectLoginError(res, 'sso_failed');
  }
};

/** Whether OIDC routes should be registered (for server wiring). */
export { isOidcConfigured };
