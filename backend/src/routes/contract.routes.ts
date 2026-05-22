import express from 'express';
import multer from 'multer';
import {
  getContracts,
  getUnassignedCounts,
  getContract,
  getContractStoInformation,
  getContractActivityLog,
  getB2bPartiesForContract,
  getContractFilterIncoterms,
  getContractFilterB2bFlags,
  getLatePerformance,
  getLatePerformanceSummary,
  getLatePerformanceTree,
  getDistinctBuyers,
  createContract,
  updateContract,
  bulkUpdateCargoReadiness,
} from '../controllers/contract.controller';
import { createContractRemark, getContractRemarks } from '../controllers/remarks.controller';
import { authenticateToken, authorize } from '../middleware/auth';
import { auditLog } from '../middleware/audit';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(csv|xlsx|xls)$/i.test(file.originalname) ||
      ['text/csv', 'application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/octet-stream', 'text/plain'].includes(file.mimetype);
    cb(null, ok);
  },
});

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
router.get('/late-performance/summary', getLatePerformanceSummary);
router.get('/late-performance/tree', getLatePerformanceTree);
router.get('/late-performance', getLatePerformance);
router.get('/filter-options/incoterms', getContractFilterIncoterms);
router.get('/filter-options/b2b-flags', getContractFilterB2bFlags);
router.get('/unassigned-counts', getUnassignedCounts);
router.get('/buyers', getDistinctBuyers);

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
router.get('/:id/remarks', getContractRemarks);
router.post('/:id/remarks', createContractRemark);
router.get('/:id/b2b-parties', getB2bPartiesForContract);
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
router.post('/bulk-cargo-readiness', authorize('ADMIN', 'TRADING'), csvUpload.single('file'), auditLog('UPDATE', 'CONTRACT'), bulkUpdateCargoReadiness);

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

