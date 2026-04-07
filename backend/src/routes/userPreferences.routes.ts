import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getMyPreference, setMyPreference } from '../controllers/userPreferences.controller';

const router = Router();

router.use(authenticateToken);

router.get('/me', getMyPreference);
router.post('/me', setMyPreference);

export default router;

