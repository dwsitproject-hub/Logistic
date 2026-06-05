import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  changePassword,
} from '../controllers/user.controller';
import { body } from 'express-validator';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Change password (available to all authenticated users)
router.post(
  '/change-password',
  [
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  changePassword
);

// Admin-only routes
router.get('/', authorize('ADMIN'), getAllUsers);
router.get('/:id', authorize('ADMIN'), getUserById);

router.post(
  '/',
  authorize('ADMIN'),
  [
    body('username').notEmpty().isLength({ min: 3, max: 100 }),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('full_name').notEmpty(),
    body('role').isIn(['ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT']),
    body('level').optional({ nullable: true }).isIn(['Dept Head', 'Section Head', 'Staff', 'Admin']),
    body('transport_type').optional({ nullable: true }).isIn(['SEA', 'LAND', 'ALL', 'MIX', 'sea', 'land', 'all', 'mix']),
    body('plants').optional({ nullable: true }).isArray(),
    body('plants.*').optional().isString(),
    body('products').optional({ nullable: true }).isArray(),
    body('products.*').optional().isString(),
  ],
  createUser
);

router.put(
  '/:id',
  authorize('ADMIN'),
  [
    body('email').optional().isEmail(),
    body('role').optional().isIn(['ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT']),
    body('level').optional({ nullable: true }).isIn(['Dept Head', 'Section Head', 'Staff', 'Admin']),
    body('transport_type').optional({ nullable: true }).isIn(['SEA', 'LAND', 'ALL', 'MIX', 'sea', 'land', 'all', 'mix']),
    body('plants').optional({ nullable: true }).isArray(),
    body('plants.*').optional().isString(),
    body('products').optional({ nullable: true }).isArray(),
    body('products.*').optional().isString(),
  ],
  updateUser
);

router.post(
  '/:id/reset-password',
  authorize('ADMIN'),
  [body('newPassword').isLength({ min: 6 })],
  resetUserPassword
);

router.delete('/:id', authorize('ADMIN'), deleteUser);

export default router;

