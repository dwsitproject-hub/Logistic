import express from 'express';
import { authenticateToken, authorizePermissionView } from '../middleware/auth';
import { listWbImports, getWbImport } from '../controllers/wbData.controller';

const router = express.Router();

// WB Data is a read-only history: ADMIN, or whoever the roles screen grants `page.wb_data` view to (migration 273).
router.use(authenticateToken, authorizePermissionView('page.wb_data'));

router.get('/imports', listWbImports);
router.get('/imports/:id', getWbImport);

export default router;
