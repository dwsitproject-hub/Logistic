import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { query } from '../database/connection';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      success: false,
      error: { message: 'Access token required' },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Token verification failed:', error);
    res.status(403).json({
      success: false,
      error: { message: 'Invalid or expired token' },
    });
    return;
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions' },
      });
      return;
    }

    next();
  };
};

/** SAP Import Management — ADMIN/MANAGEMENT, or LOGISTICS with level Admin only. */
export const authorizeSapImportsView = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { message: 'Unauthorized' },
    });
    return;
  }

  if (['ADMIN', 'MANAGEMENT'].includes(req.user.role)) {
    next();
    return;
  }

  if (req.user.role === 'LOGISTICS') {
    try {
      const result = await query('SELECT level FROM users WHERE id = $1', [req.user.id]);
      const level = String(result.rows[0]?.level ?? '').trim().toUpperCase();
      if (level === 'ADMIN') {
        next();
        return;
      }
    } catch (error) {
      logger.error('authorizeSapImportsView level lookup failed:', error);
    }
  }

  res.status(403).json({
    success: false,
    error: { message: 'Insufficient permissions' },
  });
};

async function userHasPermissionFlag(
  userId: string,
  roleName: string,
  permissionKey: string,
  flag: 'can_view' | 'can_create' | 'can_edit' | 'can_delete',
): Promise<boolean> {
  const result = await query(
    `SELECT scoped.${flag} AS allowed
     FROM roles r
     JOIN permissions p ON p.permission_key = $3
     LEFT JOIN LATERAL (
       SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
       FROM role_permissions rp
       JOIN users u ON u.id = $1
       WHERE rp.role_id = r.id
         AND rp.permission_id = p.id
         AND (
           rp.level IS NULL
           OR (
             u.level IS NOT NULL
             AND UPPER(TRIM(rp.level)) = UPPER(TRIM(u.level))
           )
         )
         AND (
           rp.transport_type IS NULL
           OR (
             u.transport_type IS NOT NULL
             AND UPPER(TRIM(rp.transport_type)) = UPPER(TRIM(u.transport_type))
           )
         )
       ORDER BY
         CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC,
         CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
       LIMIT 1
     ) scoped ON true
     WHERE r.role_name = $2 AND r.is_active = true`,
    [userId, roleName, permissionKey],
  );
  return !!result.rows[0]?.allowed;
}

/** SAP MASTER upload — ADMIN or role_permissions page.sap can_create (scoped by user level). */
export const authorizeSapImportsUpload = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { message: 'Unauthorized' },
    });
    return;
  }

  if (req.user.role === 'ADMIN') {
    next();
    return;
  }

  try {
    const canCreate = await userHasPermissionFlag(
      req.user.id,
      req.user.role,
      'page.sap',
      'can_create',
    );
    if (canCreate) {
      next();
      return;
    }
  } catch (error) {
    logger.error('authorizeSapImportsUpload permission lookup failed:', error);
  }

  res.status(403).json({
    success: false,
    error: { message: 'Insufficient permissions to upload SAP data' },
  });
};

