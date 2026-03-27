import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

// Get all users (Admin only)
export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, role, is_active, is_first_login, 
              phone, department, level, transport_type, plant, created_at, updated_at, last_password_change
       FROM users 
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch users' },
    });
  }
};

// Get user by ID
export const getUserById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT id, username, email, full_name, role, is_active, is_first_login,
              phone, department, level, transport_type, plant, created_at, updated_at, last_password_change
       FROM users 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch user' },
    });
  }
};

// Create new user (Admin only)
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, email, password, full_name, role, phone, department, level, transport_type, plant } = req.body;

    // Validate role
    const validRoles = ['ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'];
    const validLevels = ['Dept Head', 'Section Head', 'Staff', 'Admin'];
    if (level != null && level !== '' && !validLevels.includes(level)) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid level' },
      });
      return;
    }

    const normRole = String(role || '').toUpperCase();
    const normLevel = String(level || '').trim();
    const requiresTransport = normRole === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(normLevel);
    if (requiresTransport) {
      const validTransport = ['SEA', 'LAND'];
      if (!validTransport.includes(String(transport_type || '').toUpperCase())) {
        res.status(400).json({
          success: false,
          error: { message: 'Transport Type is required for LOGISTICS with Section Head/Staff/Admin level' },
        });
        return;
      }
    }

    const requiresPlant = ['LOGISTICS', 'TRADING'].includes(normRole);
    if (requiresPlant && !String(plant || '').trim()) {
      res.status(400).json({
        success: false,
        error: { message: 'Plant is required for LOGISTICS and TRADING users' },
      });
      return;
    }

    if (!validRoles.includes(role)) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid role' },
      });
      return;
    }

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

    // Hash password (default password will be provided by admin)
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role, phone, department, level, transport_type, plant, is_first_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id, username, email, full_name, role, is_active, is_first_login, phone, department, level, transport_type, plant, created_at`,
      [
        username,
        email,
        password_hash,
        full_name,
        role,
        phone,
        department,
        level || null,
        transport_type ? String(transport_type).toUpperCase() : null,
        plant || null
      ]
    );

    logger.info(`User created by ${req.user?.username}: ${username}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Create user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create user' },
    });
  }
};

// Update user (Admin only)
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { username, email, full_name, role, phone, department, level, transport_type, plant, is_active } = req.body;

    // Check if user exists
    const existingUser = await query('SELECT * FROM users WHERE id = $1', [id]);

    if (existingUser.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    // Validate role if provided
    if (role) {
      const validRoles = ['ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'];
      if (!validRoles.includes(role)) {
        res.status(400).json({
          success: false,
          error: { message: 'Invalid role' },
        });
        return;
      }
    }

    const nextRole = String(role || existingUser.rows[0].role || '').toUpperCase();
    const nextLevel = String(level ?? existingUser.rows[0].level ?? '').trim();
    const validLevels = ['Dept Head', 'Section Head', 'Staff', 'Admin'];
    if (level != null && level !== '' && !validLevels.includes(String(level))) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid level' },
      });
      return;
    }

    const requiresTransport = nextRole === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(nextLevel);
    if (requiresTransport) {
      const t = String(transport_type ?? existingUser.rows[0].transport_type ?? '').toUpperCase();
      if (!['SEA', 'LAND'].includes(t)) {
        res.status(400).json({
          success: false,
          error: { message: 'Transport Type is required for LOGISTICS with Section Head/Staff/Admin level' },
        });
        return;
      }
    }

    const requiresPlant = ['LOGISTICS', 'TRADING'].includes(nextRole);
    const nextPlant = String(plant ?? existingUser.rows[0].plant ?? '').trim();
    if (requiresPlant && !nextPlant) {
      res.status(400).json({
        success: false,
        error: { message: 'Plant is required for LOGISTICS and TRADING users' },
      });
      return;
    }

    // Check for duplicate username/email
    if (username || email) {
      const duplicateCheck = await query(
        'SELECT * FROM users WHERE (username = $1 OR email = $2) AND id != $3',
        [username || existingUser.rows[0].username, email || existingUser.rows[0].email, id]
      );

      if (duplicateCheck.rows.length > 0) {
        res.status(400).json({
          success: false,
          error: { message: 'Username or email already exists' },
        });
        return;
      }
    }

    // Update user
    const result = await query(
      `UPDATE users 
       SET username = COALESCE($1, username),
           email = COALESCE($2, email),
           full_name = COALESCE($3, full_name),
           role = COALESCE($4, role),
           phone = COALESCE($5, phone),
           department = COALESCE($6, department),
           level = COALESCE($7, level),
           transport_type = COALESCE($8, transport_type),
           plant = COALESCE($9, plant),
           is_active = COALESCE($10, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
       RETURNING id, username, email, full_name, role, is_active, is_first_login, phone, department, level, transport_type, plant, updated_at`,
      [
        username,
        email,
        full_name,
        role,
        phone,
        department,
        level ?? null,
        transport_type ? String(transport_type).toUpperCase() : null,
        plant ?? null,
        is_active,
        id
      ]
    );

    logger.info(`User updated by ${req.user?.username}: ${username || existingUser.rows[0].username}`);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update user' },
    });
  }
};

// Reset user password (Admin only)
export const resetUserPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: { message: 'Password must be at least 6 characters' },
      });
      return;
    }

    // Hash new password
    const password_hash = await bcrypt.hash(newPassword, 10);

    // Update password and set first login flag
    await query(
      `UPDATE users 
       SET password_hash = $1, 
           is_first_login = true,
           last_password_change = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [password_hash, id]
    );

    logger.info(`Password reset by ${req.user?.username} for user ID: ${id}`);

    res.json({
      success: true,
      message: 'Password reset successfully. User will be prompted to change password on next login.',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to reset password' },
    });
  }
};

// Delete user (Admin only)
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Prevent deleting own account
    if (id === req.user?.id) {
      res.status(400).json({
        success: false,
        error: { message: 'Cannot delete your own account' },
      });
      return;
    }

    // Check if user exists
    const existingUser = await query('SELECT username FROM users WHERE id = $1', [id]);

    if (existingUser.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    // Soft delete - deactivate instead of deleting
    await query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    logger.info(`User deactivated by ${req.user?.username}: ${existingUser.rows[0].username}`);

    res.json({
      success: true,
      message: 'User deactivated successfully',
    });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete user' },
    });
  }
};

// Change password (for current user and first-time login)
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: { message: 'New password must be at least 6 characters' },
      });
      return;
    }

    // Get current user
    const result = await query(
      'SELECT password_hash, is_first_login FROM users WHERE id = $1',
      [req.user?.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    const user = result.rows[0];

    // Verify current password (skip for first-time login)
    if (!user.is_first_login) {
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          error: { message: 'Current password is incorrect' },
        });
        return;
      }
    }

    // Hash new password
    const password_hash = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      `UPDATE users 
       SET password_hash = $1, 
           is_first_login = false,
           last_password_change = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [password_hash, req.user?.id]
    );

    logger.info(`Password changed by user: ${req.user?.username}`);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to change password' },
    });
  }
};

