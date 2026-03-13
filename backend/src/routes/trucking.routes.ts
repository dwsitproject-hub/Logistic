import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { getTruckingOperations, getTruckingOperationById, createTruckingOperation, validateContractNumber, updateTruckingOperation, getLandOpenContractSuggestions } from '../controllers/trucking.controller';

const router = express.Router();

router.use(authenticateToken);

// Get all trucking operations
router.get('/', getTruckingOperations);

// Contract suggestions (LAND + Open) for create form
router.get('/contracts/suggestions', getLandOpenContractSuggestions);

// Validate contract number
router.get('/validate/contract', validateContractNumber);

// Get trucking operation by ID
router.get('/:id', getTruckingOperationById);

// Create trucking operation
router.post('/', auditLog('CREATE', 'TRUCKING_OPERATION'), createTruckingOperation);

// Update trucking operation
router.put('/:id', auditLog('UPDATE', 'TRUCKING_OPERATION'), updateTruckingOperation);

export default router;
