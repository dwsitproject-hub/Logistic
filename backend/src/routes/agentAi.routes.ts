import express from 'express'
import multer from 'multer'
import { authenticateToken } from '../middleware/auth'
import { askAgentAi, rateAgentAiAnswer } from '../controllers/agentAi.controller'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage() })

router.use(authenticateToken)
router.post('/ask', upload.single('file'), askAgentAi)
router.post('/feedback', rateAgentAiAnswer)

export default router

