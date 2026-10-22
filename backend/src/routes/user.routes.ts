import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  resetUserPassword,
  resendInvitation,
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
    body('email').isEmail(),
    // No password: the user receives an invitation e-mail and chooses their own.
    body('full_name').notEmpty(),
    // Whether the role exists and is active is checked against the roles table in the controller.
    body('role').matches(/^[A-Z][A-Z_]*$/),
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
    body('role').optional().matches(/^[A-Z][A-Z_]*$/),
    body('level').optional({ nullable: true }).isIn(['Dept Head', 'Section Head', 'Staff', 'Admin']),
    body('transport_type').optional({ nullable: true }).isIn(['SEA', 'LAND', 'ALL', 'MIX', 'sea', 'land', 'all', 'mix']),
    body('plants').optional({ nullable: true }).isArray(),
    body('plants.*').optional().isString(),
    body('products').optional({ nullable: true }).isArray(),
    body('products.*').optional().isString(),
  ],
  updateUser
);

// Send the user a link to set a new password (the admin does not type one).
router.post('/:id/reset-password', authorize('ADMIN'), resetUserPassword);

// Send the invitation again to a user who has not activated the account.
router.post('/:id/resend-invitation', authorize('ADMIN'), resendInvitation);

router.delete('/:id', authorize('ADMIN'), deleteUser);

export default router;

