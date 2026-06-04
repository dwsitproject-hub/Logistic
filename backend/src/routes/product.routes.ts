import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { listProducts, createProduct, updateProduct, deleteProduct } from '../controllers/product.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), listProducts);
router.post('/', authorize('ADMIN', 'TRADING', 'LOGISTICS'), createProduct);
router.put('/:id', authorize('ADMIN', 'TRADING', 'LOGISTICS'), updateProduct);
router.delete('/:id', authorize('ADMIN'), deleteProduct);

export default router;


