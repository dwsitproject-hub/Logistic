import express from 'express';
import { authenticateToken, authorize } from '../middleware/auth';
import {
  getApiCall,
  getDhmPushState,
  getIntegrations,
  getKmapsDeliveries,
  getJpsPortOptions,
  getJpsNotifyRules,
  removeJpsNotifyRule,
  saveJpsNotifyRule,
  sendJpsNotifyTest,
  listApiCalls,
  resendKmapsDeliveries,
  retryDhmPushNow,
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
// Masters saved in KLIP that did not reach DHM, and a button to push them again. Declared before /:id so 'dhm' is not an id.
router.get('/dhm/push-state', getDhmPushState);
router.post('/dhm/push-retry', retryDhmPushNow);
// What the JPS Ports editor picks from (Master Ports and whether each has a DHM code). Before /:id.
router.get('/jps/port-options', getJpsPortOptions);
// The mail sent after Submit to Jetty: one rule per discharge port plus a default, and a test send to the administrator. Before /:id.
router.get('/jps/notify-rules', getJpsNotifyRules);
router.put('/jps/notify-rules', saveJpsNotifyRule);
router.post('/jps/notify-rules/test', sendJpsNotifyTest);
router.delete('/jps/notify-rules/:id', removeJpsNotifyRule);
// Bells KLIP rings for KMAPS, and a way to send the failed ones again. Declared before /:id so 'kmaps' is not an id.
router.get('/kmaps/webhook-deliveries', getKmapsDeliveries);
router.post('/kmaps/webhook-deliveries/resend', resendKmapsDeliveries);
// What KLIP sent to JPS or DHM and what came back (:id is jps or dhm). Bodies can hold vessel, port and quantities,
// so ADMIN only like the rest.
router.get('/:id/calls', listApiCalls);
router.get('/:id/calls/:callId', getApiCall);
router.put('/:id', updateIntegration);
router.post('/:id/test', testIntegration);

export default router;
