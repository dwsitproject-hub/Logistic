import { Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

// Get all roles
export const getAllRoles = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, role_name, display_name, description, is_active, created_at, updated_at
       FROM roles 
       ORDER BY role_name`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get all roles error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch roles' },
    });
  }
};

// Get role by ID with permissions
export const getRoleById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const level = req.query.level ? String(req.query.level) : null;
    const transportType = req.query.transportType ? String(req.query.transportType).toUpperCase() : null;

    const roleResult = await query(
      `SELECT id, role_name, display_name, description, is_active, created_at, updated_at
       FROM roles 
       WHERE id = $1`,
      [id]
    );

    if (roleResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'Role not found' },
      });
      return;
    }

    // Get role permissions
    const permissionsResult = await query(
      `SELECT p.id, p.permission_key, p.permission_name, p.description, p.category,
              rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
       FROM permissions p
       LEFT JOIN LATERAL (
         SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
         FROM role_permissions rp
         WHERE rp.role_id = $1
           AND rp.permission_id = p.id
           AND (rp.level IS NULL OR UPPER(TRIM(rp.level)) = UPPER(TRIM(COALESCE($2, rp.level))))
           AND (rp.transport_type IS NULL OR UPPER(TRIM(rp.transport_type)) = UPPER(TRIM(COALESCE($3, rp.transport_type))))
         ORDER BY
           CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC,
           CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
         LIMIT 1
       ) rp ON true
       ORDER BY p.category, p.permission_name`,
      [id, level, transportType]
    );

    res.json({
      success: true,
      data: {
        ...roleResult.rows[0],
        permissions: permissionsResult.rows,
      },
    });
  } catch (error) {
    logger.error('Get role by ID error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch role' },
    });
  }
};

// Get all permissions
export const getAllPermissions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, permission_key, permission_name, description, category, created_at
       FROM permissions 
       ORDER BY category, permission_name`
    );

    // Group by category
    const grouped = result.rows.reduce((acc: any, permission: any) => {
      const category = permission.category || 'other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(permission);
      return acc;
    }, {});

    res.json({
      success: true,
      data: grouped,
    });
  } catch (error) {
    logger.error('Get all permissions error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch permissions' },
    });
  }
};

// Get user permissions (for current user)
export const getUserPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Get user's role
    const userResult = await query(
      'SELECT role, level, transport_type FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    const userRole = userResult.rows[0].role;
    const userLevel = userResult.rows[0].level || null;
    const userTransportType = userResult.rows[0].transport_type || null;

    // Get role permissions
    const permissionsResult = await query(
      `SELECT
         p.permission_key, p.permission_name, p.category,
         scoped.can_view, scoped.can_create, scoped.can_edit, scoped.can_delete
       FROM roles r
       JOIN permissions p ON true
       LEFT JOIN LATERAL (
         SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
         FROM role_permissions rp
         WHERE rp.role_id = r.id
           AND rp.permission_id = p.id
           AND (rp.level IS NULL OR UPPER(TRIM(rp.level)) = UPPER(TRIM(COALESCE($2, rp.level))))
           AND (rp.transport_type IS NULL OR UPPER(TRIM(rp.transport_type)) = UPPER(TRIM(COALESCE($3, rp.transport_type))))
         ORDER BY
           CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC,
           CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
         LIMIT 1
       ) scoped ON true
       WHERE r.role_name = $1 AND r.is_active = true`,
      [userRole, userLevel, userTransportType]
    );

    // Format permissions for easy frontend use
    const permissions = permissionsResult.rows.reduce((acc: any, perm: any) => {
      acc[perm.permission_key] = {
        name: perm.permission_name,
        category: perm.category,
        canView: perm.can_view,
        canCreate: perm.can_create,
        canEdit: perm.can_edit,
        canDelete: perm.can_delete,
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        role: userRole,
        permissions,
      },
    });
  } catch (error) {
    logger.error('Get user permissions error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch user permissions' },
    });
  }
};

// Update role permissions
export const updateRolePermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { permissions } = req.body; // Array of {permission_id, can_view, can_create, can_edit, can_delete}
    const level = req.query.level ? String(req.query.level) : null;
    const transportType = req.query.transportType ? String(req.query.transportType).toUpperCase() : null;

    // Check if role exists
    const roleCheck = await query('SELECT role_name FROM roles WHERE id = $1', [id]);

    if (roleCheck.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'Role not found' },
      });
      return;
    }

    // Delete existing scoped permissions for this role + scope
    await query(
      `DELETE FROM role_permissions
       WHERE role_id = $1
         AND (
           ($2::text IS NULL AND level IS NULL)
           OR UPPER(TRIM(COALESCE(level, ''))) = UPPER(TRIM(COALESCE($2::text, '')))
         )
         AND (
           ($3::text IS NULL AND transport_type IS NULL)
           OR UPPER(TRIM(COALESCE(transport_type, ''))) = UPPER(TRIM(COALESCE($3::text, '')))
         )`,
      [id, level, transportType]
    );

    // Insert new permissions
    for (const perm of permissions) {
      if (perm.can_view || perm.can_create || perm.can_edit || perm.can_delete) {
        await query(
          `INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            perm.permission_id,
            perm.can_view || false,
            perm.can_create || false,
            perm.can_edit || false,
            perm.can_delete || false,
            level,
            transportType,
          ]
        );
      }
    }

    logger.info(`Role permissions updated by ${req.user?.username} for role: ${roleCheck.rows[0].role_name}`);

    res.json({
      success: true,
      message: 'Role permissions updated successfully',
    });
  } catch (error) {
    logger.error('Update role permissions error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update role permissions' },
    });
  }
};

// Create new role
export const createRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role_name, display_name, description } = req.body;

    // Validate role_name format (uppercase, no spaces)
    if (!/^[A-Z_]+$/.test(role_name)) {
      res.status(400).json({
        success: false,
        error: { message: 'Role name must be uppercase letters and underscores only' },
      });
      return;
    }

    // Check if role already exists
    const existingRole = await query('SELECT * FROM roles WHERE role_name = $1', [role_name]);

    if (existingRole.rows.length > 0) {
      res.status(400).json({
        success: false,
        error: { message: 'Role already exists' },
      });
      return;
    }

    // Create role
    const result = await query(
      `INSERT INTO roles (role_name, display_name, description)
       VALUES ($1, $2, $3)
       RETURNING id, role_name, display_name, description, is_active, created_at`,
      [role_name, display_name, description]
    );

    logger.info(`Role created by ${req.user?.username}: ${role_name}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Create role error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create role' },
    });
  }
};

// Update role
export const updateRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { display_name, description, is_active } = req.body;

    // Check if role exists
    const existingRole = await query('SELECT * FROM roles WHERE id = $1', [id]);

    if (existingRole.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'Role not found' },
      });
      return;
    }

    // Update role (role_name cannot be changed)
    const result = await query(
      `UPDATE roles 
       SET display_name = COALESCE($1, display_name),
           description = COALESCE($2, description),
           is_active = COALESCE($3, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, role_name, display_name, description, is_active, updated_at`,
      [display_name, description, is_active, id]
    );

    logger.info(`Role updated by ${req.user?.username}: ${existingRole.rows[0].role_name}`);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Update role error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update role' },
    });
  }
};

