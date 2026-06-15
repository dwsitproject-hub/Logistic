import express from 'express';
import multer from 'multer';
import { authenticateToken, authorize } from '../middleware/auth';
import { ensureUploadDir } from '../utils/fileUpload';
import {
  listSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  importSuppliersFromExcel,
  getTotalsByIsland,
  getTotalsByProvince,
  getTotalsByParentCompany,
} from '../controllers/supplier.controller';

const router = express.Router();

const uploadDir = ensureUploadDir('suppliers');
const upload = multer({ dest: uploadDir });

router.use(authenticateToken);

// List and create
router.get('/', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), listSuppliers);
router.post('/', authorize('ADMIN', 'LOGISTICS'), createSupplier);

// Detail, update, delete
router.get('/:id', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), getSupplierById);
router.put('/:id', authorize('ADMIN', 'LOGISTICS'), updateSupplier);
router.delete('/:id', authorize('ADMIN'), deleteSupplier);

// Excel import
router.post('/import', authorize('ADMIN', 'LOGISTICS'), upload.single('file'), importSuppliersFromExcel);

// Aggregates
router.get('/aggregates/by-island', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), getTotalsByIsland);
router.get('/aggregates/by-province', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), getTotalsByProvince);
router.get('/aggregates/by-parent-company', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), getTotalsByParentCompany);

export default router;


