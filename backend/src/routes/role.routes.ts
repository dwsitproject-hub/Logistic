import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getAllRoles,
  getRoleById,
  getAllPermissions,
  getUserPermissions,
  updateRolePermissions,
  createRole,
  updateRole,
} from '../controllers/role.controller';
import { body } from 'express-validator';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get user's own permissions (available to all authenticated users)
router.get('/my-permissions', getUserPermissions);

// Admin-only routes
router.get('/', authorize('ADMIN'), getAllRoles);
router.get('/permissions', authorize('ADMIN'), getAllPermissions);
router.get('/:id', authorize('ADMIN'), getRoleById);

router.post(
  '/',
  authorize('ADMIN'),
  [
    body('role_name').notEmpty().matches(/^[A-Z_]+$/),
    body('display_name').notEmpty(),
  ],
  createRole
);

router.put('/:id', authorize('ADMIN'), updateRole);

router.put(
  '/:id/permissions',
  authorize('ADMIN'),
  [body('permissions').isArray()],
  updateRolePermissions
);

export default router;

