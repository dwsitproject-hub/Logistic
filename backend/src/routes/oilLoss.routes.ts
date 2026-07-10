import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { getOilLoss } from '../controllers/oilLoss.controller';

const router = express.Router();

router.get('/', authenticateToken, getOilLoss);

export default router;
