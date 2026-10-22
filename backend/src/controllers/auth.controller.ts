import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { AuditService } from '../services/audit.service';
import {
  buildSessionUserPayload,
  establishSession,
  loadActiveUserByEmail,
  loadActiveUserById,
  saveSession,
} from '../services/sessionAuth.service';
import { AuthRequest } from '../middleware/auth';
import { getAuthLoginOptions, isLocalLoginEnabled } from '../config/authConfig';
import { normalizeEmail } from '../utils/userIdentity';
import {
  MIN_PASSWORD_LENGTH,
  RESET_REQUEST_COOLDOWN_SECONDS,
  completePasswordSetup,
  issueToken,
  peekToken,
  secondsSinceLastToken,
} from '../services/authToken.service';
import { sendPasswordResetEmail } from '../services/authEmail.service';

/*
 * There is no public self-registration. `POST /api/auth/register` used to live here: it took the role from the request body and handed back a
 * session token, so anyone could create an ADMIN account. Accounts are made by an administrator (User Management), who sends an invitation
 * e-mail; the user chooses their own password through the link (see `setPassword` below).
 */

/** GET /api/auth/login-options — which login paths are available (public). */
export const getLoginOptions = (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: getAuthLoginOptions(),
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isLocalLoginEnabled()) {
      res.status(403).json({
        success: false,
        error: {
          message: 'Local login is disabled on this server. Please use Sign in with DWS Hub.',
        },
      });
      return;
    }

    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    // Find user
    const result = await query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' },
      });
      return;
    }

    const user = result.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' },
      });
      return;
    }

    logger.info(`User logged in: ${user.email}`);

    // Log the login action
    await AuditService.log({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    const sessionUser = await buildSessionUserPayload(user);
    establishSession(req, String(user.id));
    await saveSession(req);

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    ) as string;

    res.json({
      success: true,
      data: {
        user: sessionUser,
        token,
        requirePasswordChange: user.is_first_login || false,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to login' },
    });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userRow = req.user?.id ? await loadActiveUserById(req.user.id) : null;
    if (!userRow) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    const sessionUser = await buildSessionUserPayload(userRow);

    res.json({
      success: true,
      data: sessionUser,
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get profile' },
    });
  }
};

/** GET /api/auth/me — current session user (cookie or Bearer). */
export const getMe = getProfile;

export const logout = (req: Request, res: Response): void => {
  req.session?.destroy((err) => {
    if (err) {
      logger.error('Session destroy failed on logout', { err });
      res.status(500).json({
        success: false,
        error: { message: 'Failed to logout' },
      });
      return;
    }
    res.clearCookie('klip.sid');
    res.json({ success: true, data: { message: 'Logged out' } });
  });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { full_name, email } = req.body;
    
    const result = await query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name), 
           email = COALESCE($2, email),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, username, email, full_name, role, level, transport_type, plant, is_active`,
      [full_name, email, req.user?.id]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update profile' },
    });
  }
};

const LOCAL_LOGIN_DISABLED_MESSAGE =
  'Local login is disabled on this server. Please use Sign in with DWS Hub.';

/** The answer to every "forgot password" request that was well formed: it never says whether the e-mail has an account. */
export const FORGOT_PASSWORD_MESSAGE =
  'If that e-mail belongs to an active KLIP account, a link to reset the password has been sent to it.';

export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired. Please request a new one.';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/auth/forgot-password { email } (public). */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isLocalLoginEnabled()) {
      res.status(403).json({ success: false, error: { message: LOCAL_LOGIN_DISABLED_MESSAGE } });
      return;
    }

    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_SHAPE.test(email) || email.length > 254) {
      res.status(400).json({ success: false, error: { message: 'A valid e-mail address is required' } });
      return;
    }

    const user = await loadActiveUserByEmail(email);
    if (user) {
      const userId = String(user.id);
      const age = await secondsSinceLastToken({ query }, userId, 'RESET');
      // A second request inside the cooldown sends nothing (the first link is still valid), but answers the same way.
      if (age === null || age >= RESET_REQUEST_COOLDOWN_SECONDS) {
        const { token } = await issueToken({ query }, userId, 'RESET');
        await AuditService.log({
          userId,
          action: 'PASSWORD_RESET_REQUESTED',
          entityType: 'USER',
          entityId: userId,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
        });
        // Not awaited: the SMTP round trip would make an existing account answer slower than an unknown e-mail.
        void sendPasswordResetEmail(
          { email: String(user.email), fullName: (user.full_name as string | null) ?? null },
          token,
        ).then((sent) => {
          if (!sent) logger.warn('Password reset e-mail was not sent (SMTP not configured or failed)', { userId });
        });
      }
    }

    res.json({ success: true, data: { message: FORGOT_PASSWORD_MESSAGE } });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to process the request' } });
  }
};

/** POST /api/auth/password-token/validate { token } (public): what the set-password page needs to show itself. */
export const validatePasswordToken = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isLocalLoginEnabled()) {
      res.status(403).json({ success: false, error: { message: LOCAL_LOGIN_DISABLED_MESSAGE } });
      return;
    }
    const pending = await peekToken({ query }, String(req.body?.token ?? ''));
    if (!pending) {
      res.json({ success: true, data: { valid: false } });
      return;
    }
    res.json({
      success: true,
      data: { valid: true, purpose: pending.purpose, full_name: pending.fullName, email: pending.email },
    });
  } catch (error) {
    logger.error('Validate password token error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to validate the link' } });
  }
};

/** POST /api/auth/set-password { token, newPassword } (public): spend the link and store the user's own password. */
export const setPassword = async (req: Request, res: Response): Promise<void> => {
  const client = await getClient();
  let transactionStarted = false;
  try {
    if (!isLocalLoginEnabled()) {
      res.status(403).json({ success: false, error: { message: LOCAL_LOGIN_DISABLED_MESSAGE } });
      return;
    }

    const token = String(req.body?.token ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        success: false,
        error: { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      });
      return;
    }

    await client.query('BEGIN');
    transactionStarted = true;
    const owner = await completePasswordSetup(client, token, newPassword);
    if (!owner) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      res.status(400).json({ success: false, error: { message: INVALID_LINK_MESSAGE } });
      return;
    }
    await client.query('COMMIT');
    transactionStarted = false;

    await AuditService.log({
      userId: owner.userId,
      action: owner.purpose === 'INVITE' ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: owner.userId,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    });
    logger.info(`Password set through e-mail link (${owner.purpose}): ${owner.email}`);

    res.json({ success: true, data: { message: 'Your password has been saved. You can sign in now.' } });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    logger.error('Set password error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to save the password' } });
  } finally {
    client.release();
  }
};