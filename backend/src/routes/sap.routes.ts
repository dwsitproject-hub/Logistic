import { Router } from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import * as sapController from '../controllers/sap.controller';

const router = Router();

// SAP Data Import Routes
router.post('/import', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.importSapData);
router.get('/imports', authenticateToken, authorize('ADMIN', 'SUPPORT', 'MANAGEMENT'), sapController.getImportHistory);
router.get('/imports/:id', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.getImportDetails);
router.delete('/imports/:id', authenticateToken, authorize('ADMIN'), sapController.deleteImport);

// SAP Raw Data Routes
router.get('/raw-data', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.getRawData);
router.get('/raw-data/:id', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.getRawDataById);
router.put('/raw-data/:id/process', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.processRawData);

// SAP Processed Data Routes
router.get('/processed-data', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT'), sapController.getProcessedData);
router.get('/processed-data/:id', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT'), sapController.getProcessedDataById);
router.put('/processed-data/:id', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE'), sapController.updateProcessedData);

// User Data Input Routes
router.post('/user-inputs', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE'), sapController.createUserInput);
router.get('/user-inputs', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT'), sapController.getUserInputs);
router.put('/user-inputs/:id', authenticateToken, authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE'), sapController.updateUserInput);
router.delete('/user-inputs/:id', authenticateToken, authorize('ADMIN'), sapController.deleteUserInput);

// Field Mapping Routes
router.get('/field-mappings', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.getFieldMappings);
router.post('/field-mappings', authenticateToken, authorize('ADMIN'), sapController.createFieldMapping);
router.put('/field-mappings/:id', authenticateToken, authorize('ADMIN'), sapController.updateFieldMapping);
router.delete('/field-mappings/:id', authenticateToken, authorize('ADMIN'), sapController.deleteFieldMapping);

// Validation Rules Routes
router.get('/validation-rules', authenticateToken, authorize('ADMIN', 'SUPPORT'), sapController.getValidationRules);
router.post('/validation-rules', authenticateToken, authorize('ADMIN'), sapController.createValidationRule);
router.put('/validation-rules/:id', authenticateToken, authorize('ADMIN'), sapController.updateValidationRule);
router.delete('/validation-rules/:id', authenticateToken, authorize('ADMIN'), sapController.deleteValidationRule);

// Dashboard and Analytics Routes
router.get('/dashboard', authenticateToken, authorize('ADMIN', 'MANAGEMENT'), sapController.getSapDashboard);
router.get('/analytics', authenticateToken, authorize('ADMIN', 'MANAGEMENT'), sapController.getSapAnalytics);
router.get('/reports', authenticateToken, authorize('ADMIN', 'MANAGEMENT'), sapController.getSapReports);

export default router;
