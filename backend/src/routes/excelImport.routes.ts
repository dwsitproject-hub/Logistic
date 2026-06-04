import { Router } from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import * as excelImportController from '../controllers/excelImport.controller';

const router = Router();

// Excel Import Routes
router.post('/import', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.importFromExcel);
router.post('/import/logistics-overview', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.importLogisticsOverview);

// Excel File Analysis Routes
router.get('/sheets', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.getSheetNames);
router.get('/preview', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.previewExcelData);
router.get('/validate', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.validateExcelStructure);

// Scheduled Import Management Routes
router.get('/schedules', authenticateToken, authorize('ADMIN', 'SUPPORT', 'MANAGEMENT'), excelImportController.getScheduledImports);
router.get('/schedules/:id', authenticateToken, authorize('ADMIN', 'SUPPORT', 'MANAGEMENT'), excelImportController.getScheduledImport);
router.put('/schedules/:id', authenticateToken, authorize('ADMIN'), excelImportController.updateScheduledImport);
router.delete('/schedules/:id', authenticateToken, authorize('ADMIN'), excelImportController.deleteScheduledImport);
router.post('/schedules/:id/execute', authenticateToken, authorize('ADMIN', 'SUPPORT'), excelImportController.executeScheduledImportManually);

// Scheduler Status Route
router.get('/scheduler/status', authenticateToken, authorize('ADMIN', 'SUPPORT', 'MANAGEMENT'), excelImportController.getSchedulerStatus);

export default router;
