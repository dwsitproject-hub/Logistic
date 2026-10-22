import express from 'express';
import {
  login,
  forgotPassword,
  validatePasswordToken,
  setPassword,
  getLoginOptions,
  getProfile,
  getMe,
  logout,
  updateProfile,
} from '../controllers/auth.controller';
import { ssoExchangeHandler } from '../controllers/sso.controller';
import { authenticateToken } from '../middleware/auth';
import { body } from 'express-validator';
import { forgotPasswordLimiter, passwordLinkLimiter } from '../middleware/authRateLimit';

const router = express.Router();

// No public registration: an administrator creates accounts (User Management) and the user sets a password from the e-mailed link.

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Ask for a password reset link by e-mail (always answers 200 for a well-formed e-mail)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Generic confirmation
 *       429:
 *         description: Too many requests
 */
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);

/**
 * @swagger
 * /api/auth/password-token/validate:
 *   post:
 *     summary: Check whether an invitation / reset link is still usable
 *     tags: [Authentication]
 */
router.post('/password-token/validate', passwordLinkLimiter, validatePasswordToken);

/**
 * @swagger
 * /api/auth/set-password:
 *   post:
 *     summary: Set the password with an invitation / reset link token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password saved
 *       400:
 *         description: Link invalid or expired, or password too short
 */
router.post('/set-password', passwordLinkLimiter, setPassword);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.get('/login-options', getLoginOptions);

router.post(
  '/login',
  [body('email').isEmail(), body('password').notEmpty()],
  login
);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/profile', authenticateToken, getProfile);

router.get('/me', authenticateToken, getMe);

router.post('/logout', logout);

/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put('/profile', authenticateToken, updateProfile);

/**
 * @swagger
 * /api/auth/sso/exchange:
 *   post:
 *     summary: Exchange a one-time Downstream Hub SSO code for a KLIP session
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Exchange successful
 *       400:
 *         description: Invalid or expired code
 */
router.post('/sso/exchange', ssoExchangeHandler);

export default router;

