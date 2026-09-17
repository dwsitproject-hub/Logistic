import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { AuthRequest } from './auth';
import { loadActiveUserById } from '../services/sessionAuth.service';

export async function resolveAuthenticatedUser(
  req: AuthRequest,
): Promise<{ id: string; username: string; email: string; role: string } | null> {
  if (req.session?.userId) {
    const userRow = await loadActiveUserById(req.session.userId);
    if (userRow) {
      return {
        id: String(userRow.id),
        username: String(userRow.username),
        email: String(userRow.email),
        role: String(userRow.role),
      };
    }
    return null;
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      username: string;
      email: string;
      role: string;
    };
    return decoded;
  } catch {
    return null;
  }
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({
        success: false,
        error: { message: 'Access token required' },
      });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error('Authentication failed:', error);
    res.status(401).json({
      success: false,
      error: { message: 'Authentication failed' },
    });
  }
};

/** Optional auth — attaches user when present but does not reject. */
export const optionalAuthenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (user) req.user = user;
  } catch {
    /* ignore */
  }
  next();
};
