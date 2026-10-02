import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getIntegrations,
  getJpsCall,
  listJpsCalls,
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
// What KLIP sent to JPS and what came back. Bodies can hold vessel, port and quantities, so ADMIN only like the rest.
router.get('/jps/calls', listJpsCalls);
router.get('/jps/calls/:callId', getJpsCall);
router.put('/:id', updateIntegration);
router.post('/:id/test', testIntegration);

export default router;
