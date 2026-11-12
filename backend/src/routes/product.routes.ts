import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { listProducts, createProduct, updateProduct, deleteProduct, listProductMaterials, linkProductMaterial } from '../controllers/product.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), listProducts);
router.get('/materials', authorize('ADMIN', 'TRADING', 'LOGISTICS', 'FINANCE', 'MANAGEMENT', 'SUPPORT'), listProductMaterials);
router.put('/materials/:id', authorize('ADMIN', 'TRADING', 'LOGISTICS'), linkProductMaterial);
router.post('/', authorize('ADMIN', 'TRADING', 'LOGISTICS'), createProduct);
router.put('/:id', authorize('ADMIN', 'TRADING', 'LOGISTICS'), updateProduct);
router.delete('/:id', authorize('ADMIN'), deleteProduct);

export default router;


