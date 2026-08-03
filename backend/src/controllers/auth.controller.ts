import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuditService } from '../services/audit.service';
import {
  buildSessionUserPayload,
  establishSession,
  loadActiveUserById,
  saveSession,
} from '../services/sessionAuth.service';
import { AuthRequest } from '../middleware/auth';
import { getAuthLoginOptions, isLocalLoginEnabled } from '../config/authConfig';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, full_name, role } = req.body;

    // Check if user already exists
    const existingUser = await query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      res.status(400).json({
        success: false,
        error: { message: 'Username or email already exists' },
      });
      return;
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, is_active, created_at`,
      [username, email, password_hash, full_name, role]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    ) as string;

    logger.info(`User registered: ${username}`);

    res.status(201).json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to register user' },
    });
  }
};

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

    const { username, password } = req.body;

    // Find user
    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
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

    logger.info(`User logged in: ${username}`);

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