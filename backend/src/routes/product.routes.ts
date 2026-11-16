import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { listProducts, getProductSummary, createProduct, updateProduct, deleteProduct } from '../controllers/product.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), listProducts);
// the cards above the Master Product list; before the '/:id' routes
router.get('/summary', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), getProductSummary);
router.post('/', authorize('ADMIN', 'TRADING', 'LOGISTICS'), createProduct);
router.put('/:id', authorize('ADMIN', 'TRADING', 'LOGISTICS'), updateProduct);
router.delete('/:id', authorize('ADMIN'), deleteProduct);

export default router;


