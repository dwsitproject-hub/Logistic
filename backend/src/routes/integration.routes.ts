import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import { getIntegrations, testIntegration, updateIntegration } from '../controllers/integration.controller';

/**
 * Integrations menu. ADMIN only, every route: these hold the credentials KLIP uses to act on other
 * systems, so there is no read-only tier for other roles.
 */
const router = express.Router();

router.use(authenticateToken);
router.use(authorize('ADMIN'));

router.get('/', getIntegrations);
router.put('/:id', updateIntegration);
router.post('/:id/test', testIntegration);

export default router;
