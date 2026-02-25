import express from 'express';
import {
  getContracts,
  getContract,
  getContractStoInformation,
  getContractActivityLog,
  createContract,
  updateContract,
} from '../controllers/contract.controller';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @swagger
 * /api/contracts:
 *   get:
 *     summary: Get all contracts
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: supplier
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Contracts retrieved successfully
 */
router.get('/', getContracts);

/**
 * @swagger
 * /api/contracts/{id}:
 *   get:
 *     summary: Get contract by ID
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contract retrieved successfully
 *       404:
 *         description: Contract not found
 */
router.get('/:id/sto-information', getContractStoInformation);
router.get('/:id/activity-log', getContractActivityLog);
router.get('/:id', getContract);

/**
 * @swagger
 * /api/contracts:
 *   post:
 *     summary: Create new contract
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contract_id
 *               - buyer
 *               - supplier
 *               - product
 *               - quantity_ordered
 *               - unit
 *             properties:
 *               contract_id:
 *                 type: string
 *               buyer:
 *                 type: string
 *               supplier:
 *                 type: string
 *               product:
 *                 type: string
 *               quantity_ordered:
 *                 type: number
 *               unit:
 *                 type: string
 *               incoterm:
 *                 type: string
 *               loading_site:
 *                 type: string
 *               unloading_site:
 *                 type: string
 *               contract_date:
 *                 type: string
 *                 format: date
 *               delivery_start_date:
 *                 type: string
 *                 format: date
 *               delivery_end_date:
 *                 type: string
 *                 format: date
 *               contract_value:
 *                 type: number
 *               currency:
 *                 type: string
 *     responses:
 *       201:
 *         description: Contract created successfully
 */
router.post('/', authorize('ADMIN', 'TRADING'), auditLog('CREATE', 'CONTRACT'), createContract);

/**
 * @swagger
 * /api/contracts/{id}:
 *   put:
 *     summary: Update contract
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Contract updated successfully
 *       404:
 *         description: Contract not found
 */
router.put('/:id', authorize('ADMIN', 'TRADING'), auditLog('UPDATE', 'CONTRACT'), updateContract);

export default router;

