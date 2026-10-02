import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getApiCall,
  getIntegrations,
  listApiCalls,
  testIntegration,
  updateIntegration,
} from '../controllers/integration.controller';

/**
 * Integrations menu. ADMIN only, every route: these hold the credentials KLIP uses to act on other
 * systems, so there is no read-only tier for other roles.
 */
const router = express.Router();

router.use(authenticateToken);
router.use(authorize('ADMIN'));

router.get('/', getIntegrations);
// What KLIP sent to JPS or DHM and what came back (:id is jps or dhm). Bodies can hold vessel, port and quantities,
// so ADMIN only like the rest.
router.get('/:id/calls', listApiCalls);
router.get('/:id/calls/:callId', getApiCall);
router.put('/:id', updateIntegration);
router.post('/:id/test', testIntegration);

export default router;
