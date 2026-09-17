import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { getQualitySurveys } from '../controllers/qualitySurvey.controller';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getQualitySurveys);

export default router;
