import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { query, getClient } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { deriveUsernameFromEmail, normalizeEmail } from '../utils/userIdentity';
import { canonicalizeUserRegionSites } from '../utils/userRegionSite';
import { isValidUserRole } from '../utils/userRoles';

type UserAssociations = {
  groupPlantsByUser: Map<string, string[]>;
  productsByUser: Map<string, string[]>;
};

const legacyPlantSummary = (groupPlants: string[]): string | null => {
  if (groupPlants.length === 0) return null;
  return groupPlants.join(', ').slice(0, 150);
};

async function fetchUserAssociations(userIds: string[]): Promise<UserAssociations> {
  const groupPlantsByUser = new Map<string, string[]>();
  const productsByUser = new Map<string, string[]>();

  if (userIds.length === 0) {
    return { groupPlantsByUser, productsByUser };
  }

  const [groupPlantsResult, productsResult] = await Promise.all([
    query(
      `SELECT urs.user_id, urs.region_site AS group_plant
       FROM user_region_sites urs
       WHERE urs.user_id = ANY($1::uuid[])
       ORDER BY urs.region_site`,
      [userIds]
    ),
    query(
      `SELECT up.user_id, p.product_name
       FROM user_products up
       JOIN products p ON p.id = up.product_id
       WHERE up.user_id = ANY($1::uuid[])
       ORDER BY p.product_name`,
      [userIds]
    ),
  ]);

  const groupPlantRowsByUser = new Map<string, unknown[]>();
  for (const row of groupPlantsResult.rows) {
    const list = groupPlantRowsByUser.get(row.user_id) ?? [];
    list.push(row.group_plant);
    groupPlantRowsByUser.set(row.user_id, list);
  }
  for (const [userId, names] of groupPlantRowsByUser) {
    groupPlantsByUser.set(userId, canonicalizeUserRegionSites(names));
  }

  for (const row of productsResult.rows) {
    const list = productsByUser.get(row.user_id) ?? [];
    list.push(row.product_name);
    productsByUser.set(row.user_id, list);
  }

  return { groupPlantsByUser, productsByUser };
}

function enrichUserRow(row: Record<string, unknown>, associations: UserAssociations) {
  const userId = String(row.id);
  /*
   * No fallback to the legacy `plant` text column. It holds labels from master_plants.group_plant -
   * the plant dimension - so reading it when user_region_sites is empty would quietly restore the
   * very scope migration 177 exists to retire, and an admin who cleared a user would see it come
   * back. Empty means empty until someone picks from the Region/Site list.
   */
  const groupPlants = canonicalizeUserRegionSites(
    associations.groupPlantsByUser.get(userId) ?? [],
  );
  const products = associations.productsByUser.get(userId) ?? [];

  return {
    ...row,
    plants: groupPlants,
    group_plants: groupPlants,
    products,
    plant: legacyPlantSummary(groupPlants),
  };
}

/**
 * Store the Region/Site the admin actually picked.
 *
 * The picker has always listed SAP Discharge Destination - it reads
 * /contracts/filter-options/group-plants, which is REGION_SITE_FILTER_OPTIONS_SQL, the same list
 * the Region/Site dropdown on Shipments uses. This function used to take that choice and look it
 * up in master_plants.group_plant so it could store a foreign key, and those are two different
 * dimensions sharing four labels out of fourteen. LUBUK GAUNG, BATAM, KUMAI, PALEMBANG, BELAWAN,
 * TANJUNG MORAWA and TANGERANG all matched nothing and were dropped with only a logger.warn, so
 * the admin saw the name they picked disappear and the user opened Shipments scoped to nothing.
 *
 * Nothing is looked up now. What was chosen is what is stored, which is also what every page
 * filters by - see migration 177.
 */
async function syncUserRegionSites(
  client: PoolClient,
  userId: string,
  regionSiteNames: string[] | null | undefined
): Promise<string[]> {
  await client.query('DELETE FROM user_region_sites WHERE user_id = $1', [userId]);
  // The old junction rows hold values from the plant dimension. Clear them as each user is saved
  // so nothing can quietly read a scope we no longer mean.
  await client.query('DELETE FROM user_plants WHERE user_id = $1', [userId]);

  const uniqueNames = canonicalizeUserRegionSites(regionSiteNames ?? []);
  if (uniqueNames.length === 0) {
    return [];
  }

  await client.query(
    `INSERT INTO user_region_sites (user_id, region_site)
     SELECT $1, unnest($2::text[])
     ON CONFLICT (user_id, region_site) DO NOTHING`,
    [userId, uniqueNames]
  );

  return uniqueNames;
}

async function syncUserProducts(
  client: PoolClient,
  userId: string,
  productNames: string[] | null | undefined
): Promise<string[]> {
  await client.query('DELETE FROM user_products WHERE user_id = $1', [userId]);

  if (!productNames || productNames.length === 0) {
    return [];
  }

  const uniqueNames = [...new Set(productNames.map((name) => String(name).trim()).filter(Boolean))];
  if (uniqueNames.length === 0) {
    return [];
  }

  // Ensure master rows exist (dropdown may list contract-derived product names).
  await client.query(
    `INSERT INTO products (product_name)
     SELECT TRIM(name)
     FROM unnest($1::text[]) AS name
     WHERE TRIM(name) <> ''
     ON CONFLICT (product_name) DO NOTHING`,
    [uniqueNames]
  );

  const resolved = await client.query(
    `SELECT id, product_name
     FROM products
     WHERE TRIM(LOWER(product_name)) = ANY(
       SELECT TRIM(LOWER(unnest($1::text[])))
     )`,
    [uniqueNames]
  );

  for (const row of resolved.rows) {
    await client.query(
      `INSERT INTO user_products (user_id, product_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO NOTHING`,
      [userId, row.id]
    );
  }

  return resolved.rows.map((row) => row.product_name as string);
}

// Get all users (Admin only)
export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, role, is_active, is_first_login,
              phone, department, level, transport_type, plant, created_at, updated_at, last_password_change
       FROM users
       ORDER BY created_at DESC`
    );

    const userIds = result.rows.map((row) => row.id as string);
    const associations = await fetchUserAssociations(userIds);

    res.json({
      success: true,
      data: result.rows.map((row) => enrichUserRow(row, associations)),
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

    const associations = await fetchUserAssociations([id]);
    res.json({
      success: true,
      data: enrichUserRow(result.rows[0], associations),
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
  const client = await getClient();
  let transactionStarted = false;

  try {
    const {
      email,
      password,
      full_name,
      role,
      phone,
      department,
      level,
      transport_type,
      plants,
      products,
    } = req.body;

    const normalizedEmail = normalizeEmail(email);
    const username = deriveUsernameFromEmail(normalizedEmail);

    if (!normalizedEmail) {
      res.status(400).json({
        success: false,
        error: { message: 'Email is required' },
      });
      return;
    }

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
      const validTransport = ['SEA', 'LAND', 'ALL', 'MIX'];
      if (!validTransport.includes(String(transport_type || '').toUpperCase())) {
        res.status(400).json({
          success: false,
          error: { message: 'Transport Type is required for LOGISTICS with Section Head/Staff/Admin level' },
        });
        return;
      }
    }

    if (!isValidUserRole(role)) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid role' },
      });
      return;
    }

    const existingUser = await client.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR username = $2',
      [normalizedEmail, username]
    );

    if (existingUser.rows.length > 0) {
      res.status(400).json({
        success: false,
        error: { message: 'Email already exists' },
      });
      return;
    }

    const scopedPlants = ['LOGISTICS', 'TRADING'].includes(normRole) ? (plants ?? []) : [];
    const scopedProducts = ['LOGISTICS', 'TRADING'].includes(normRole) ? (products ?? []) : [];
    const password_hash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    transactionStarted = true;

    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, phone, department, level, transport_type, plant, is_first_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id, username, email, full_name, role, is_active, is_first_login, phone, department, level, transport_type, plant, created_at`,
      [
        username,
        normalizedEmail,
        password_hash,
        full_name,
        role,
        phone,
        department,
        level || null,
        transport_type ? String(transport_type).toUpperCase() : null,
        null,
      ]
    );

    const userId = result.rows[0].id as string;
    const savedPlants = await syncUserRegionSites(client, userId, scopedPlants);
    const savedProducts = await syncUserProducts(client, userId, scopedProducts);
    const plantSummary = legacyPlantSummary(savedPlants);

    await client.query(
      'UPDATE users SET plant = $1 WHERE id = $2',
      [plantSummary, userId]
    );

    await client.query('COMMIT');

    logger.info(`User created by ${req.user?.username}: ${normalizedEmail}`);

    res.status(201).json({
      success: true,
      data: {
        ...result.rows[0],
        plant: plantSummary,
        plants: savedPlants,
        group_plants: savedPlants,
        products: savedProducts,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    logger.error('Create user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create user' },
    });
  } finally {
    client.release();
  }
};

// Update user (Admin only)
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const client = await getClient();
  let transactionStarted = false;

  try {
    const { id } = req.params;
    const {
      email,
      full_name,
      role,
      phone,
      department,
      level,
      transport_type,
      plants,
      products,
      is_active,
    } = req.body;

    const existingUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);

    if (existingUser.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

    const normalizedEmail = email != null && String(email).trim() !== ''
      ? normalizeEmail(email)
      : null;
    const nextUsername = normalizedEmail != null
      ? deriveUsernameFromEmail(normalizedEmail)
      : null;

    if (role) {
      if (!isValidUserRole(role)) {
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
      if (!['SEA', 'LAND', 'ALL', 'MIX'].includes(t)) {
        res.status(400).json({
          success: false,
          error: { message: 'Transport Type is required for LOGISTICS with Section Head/Staff/Admin level' },
        });
        return;
      }
    }

    if (normalizedEmail || nextUsername) {
      const duplicateCheck = await client.query(
        'SELECT * FROM users WHERE (username = $1 OR LOWER(email) = LOWER($2)) AND id != $3',
        [
          nextUsername ?? existingUser.rows[0].username,
          normalizedEmail ?? existingUser.rows[0].email,
          id,
        ]
      );

      if (duplicateCheck.rows.length > 0) {
        res.status(400).json({
          success: false,
          error: { message: 'Email already exists' },
        });
        return;
      }
    }

    const shouldSyncAssociations = plants !== undefined || products !== undefined;
    const scopedPlants = ['LOGISTICS', 'TRADING'].includes(nextRole)
      ? (plants ?? [])
      : [];
    const scopedProducts = ['LOGISTICS', 'TRADING'].includes(nextRole)
      ? (products ?? [])
      : [];

    await client.query('BEGIN');
    transactionStarted = true;

    let savedPlants: string[] | undefined;
    let savedProducts: string[] | undefined;
    let plantSummary: string | null | undefined;

    if (shouldSyncAssociations) {
      savedPlants = await syncUserRegionSites(client, id, scopedPlants);
      savedProducts = await syncUserProducts(client, id, scopedProducts);
      plantSummary = legacyPlantSummary(savedPlants);
    }

    const updateParams = [
      nextUsername,
      normalizedEmail,
      full_name,
      role,
      phone,
      department,
      level ?? null,
      transport_type ? String(transport_type).toUpperCase() : null,
      is_active,
      id,
    ];

    const plantClause = shouldSyncAssociations ? 'plant = $11,' : '';
    if (shouldSyncAssociations) {
      updateParams.push(plantSummary);
    }

    const result = await client.query(
      `UPDATE users
       SET username = COALESCE($1, username),
           email = COALESCE($2, email),
           full_name = COALESCE($3, full_name),
           role = COALESCE($4, role),
           phone = COALESCE($5, phone),
           department = COALESCE($6, department),
           level = COALESCE($7, level),
           transport_type = COALESCE($8, transport_type),
           ${plantClause}
           is_active = COALESCE($9, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING id, username, email, full_name, role, is_active, is_first_login, phone, department, level, transport_type, plant, updated_at`,
      updateParams
    );

    await client.query('COMMIT');

    logger.info(`User updated by ${req.user?.username}: ${normalizedEmail ?? existingUser.rows[0].email}`);

    const responseData = { ...result.rows[0] };
    if (savedPlants) {
      responseData.plants = savedPlants;
      responseData.group_plants = savedPlants;
      responseData.products = savedProducts ?? [];
      responseData.plant = plantSummary;
    } else {
      const associations = await fetchUserAssociations([id]);
      const enriched = enrichUserRow(result.rows[0], associations);
      responseData.plants = enriched.plants;
      responseData.group_plants = enriched.group_plants;
      responseData.products = enriched.products;
      responseData.plant = enriched.plant;
    }

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    logger.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update user' },
    });
  } finally {
    client.release();
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

    const password_hash = await bcrypt.hash(newPassword, 10);

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

    if (id === req.user?.id) {
      res.status(400).json({
        success: false,
        error: { message: 'Cannot delete your own account' },
      });
      return;
    }

    const existingUser = await query('SELECT username FROM users WHERE id = $1', [id]);

    if (existingUser.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'User not found' },
      });
      return;
    }

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

    const password_hash = await bcrypt.hash(newPassword, 10);

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
