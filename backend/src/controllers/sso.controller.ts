import crypto from 'crypto';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { jwtVerify } from 'jose';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuditService } from '../services/audit.service';
import { fetchUserScopeAssociations } from '../services/userAssociations.service';

/**
 * Downstream Hub SSO — additive login path alongside existing username/password
 * login. See docs/SSO-INTEGRATION-GUIDE.md for the full contract.
 *
 * Flow: Hub POSTs a short-lived JWT to POST /auth/hub -> we verify it, map the
 * user by email (invite-only), mint a normal KLIP session, and hand it to the
 * frontend via a single-use exchange code (never put the KLIP JWT itself in a
 * redirect URL / browser history).
 */

type SsoExchangePayload = {
  user: Record<string, unknown>;
  token: string;
  requirePasswordChange: false;
};

const SSO_EXCHANGE_CODE_TTL_MS = 30_000;
const ssoExchangeStore = new Map<string, { payload: SsoExchangePayload; expiresAt: number }>();

function pruneExpiredSsoExchangeCodes(): void {
  const now = Date.now();
  for (const [code, entry] of ssoExchangeStore.entries()) {
    if (entry.expiresAt <= now) ssoExchangeStore.delete(code);
  }
}

function appPublicOrigin(): string {
  return String(process.env.APP_PUBLIC_ORIGIN || '').replace(/\/$/, '');
}

function redirectToLoginWithError(res: Response, errorCode: string): void {
  const origin = appPublicOrigin();
  res.redirect(302, `${origin}/login?error=${encodeURIComponent(errorCode)}`);
}

/** POST /auth/hub — unauthenticated; legacy Hub HS256 JWT bridge (SSO_LEGACY_BRIDGE=true only). */
export const ssoHubHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tokenString = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!tokenString) {
      res.status(400).send('Missing token');
      return;
    }

    const ssoSecret = process.env.SSO_TOKEN_SECRET;
    if (!ssoSecret) {
      logger.error('SSO login attempted but SSO_TOKEN_SECRET is not configured');
      redirectToLoginWithError(res, 'sso_not_configured');
      return;
    }

    let payload: Record<string, unknown>;
    try {
      const secret = new TextEncoder().encode(ssoSecret);
      const result = await jwtVerify(tokenString, secret, { algorithms: ['HS256'] });
      payload = result.payload as Record<string, unknown>;
    } catch (error) {
      logger.warn('SSO token verification failed', { message: (error as Error)?.message });
      redirectToLoginWithError(res, 'sso_failed');
      return;
    }

    const email =
      typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const hubUserId = typeof payload.user_id === 'string' ? payload.user_id : '';
    if (!email || !hubUserId) {
      redirectToLoginWithError(res, 'sso_failed');
      return;
    }

    // Invite-only: the user must already exist in KLIP (created by an Admin).
    const result = await query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [email],
    );
    const user = result.rows[0];
    if (!user) {
      redirectToLoginWithError(res, 'sso_no_access');
      return;
    }

    const klipToken = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' },
    ) as string;

    await AuditService.log({
      userId: user.id,
      action: 'SSO_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.get('user-agent'),
    });

    const scope = await fetchUserScopeAssociations(user.id, user.plant);

    const exchangePayload: SsoExchangePayload = {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        level: user.level || null,
        transport_type: user.transport_type || null,
        plant: user.plant || null,
        plants: scope.plants,
        group_plants: scope.group_plants,
        products: scope.products,
        is_active: user.is_active,
        is_first_login: false,
      },
      token: klipToken,
      requirePasswordChange: false,
    };

    pruneExpiredSsoExchangeCodes();
    const code = crypto.randomUUID();
    ssoExchangeStore.set(code, {
      payload: exchangePayload,
      expiresAt: Date.now() + SSO_EXCHANGE_CODE_TTL_MS,
    });

    logger.info(`SSO login: user ${user.username} via Downstream Hub`);

    const origin = appPublicOrigin();
    res.redirect(302, `${origin}/sso/callback?code=${encodeURIComponent(code)}`);
  } catch (error) {
    logger.error('SSO hub login error:', error);
    redirectToLoginWithError(res, 'sso_failed');
  }
};

/** POST /api/auth/sso/exchange — single-use code -> same payload shape as /api/auth/login. */
export const ssoExchangeHandler = async (req: Request, res: Response): Promise<void> => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) {
    res.status(400).json({ success: false, error: { message: 'Missing code' } });
    return;
  }

  const entry = ssoExchangeStore.get(code);
  ssoExchangeStore.delete(code);

  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(400).json({
      success: false,
      error: { message: 'Invalid or expired SSO code' },
    });
    return;
  }

  res.json({ success: true, data: entry.payload });
};
