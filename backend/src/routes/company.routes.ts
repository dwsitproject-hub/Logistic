import { Router } from 'express'
import { authenticateToken, authorize } from '../middleware/auth'
import { listCompanies, createCompany, updateCompany, getCompanyStats, addCompanyNote, listCompanyNotes, uploadCompanies } from '../controllers/company.controller'
import multer from 'multer'
const upload = multer()

const router = Router()

router.use(authenticateToken)

router.get('/', authorize('ADMIN','TRADING','LOGISTICS','FINANCE','MANAGEMENT','SUPPORT'), listCompanies)
router.post('/', authorize('ADMIN','TRADING','MANAGEMENT','SUPPORT'), createCompany)
router.put('/:id', authorize('ADMIN','TRADING','MANAGEMENT','SUPPORT'), updateCompany)
router.get('/stats', authorize('ADMIN','TRADING','LOGISTICS','FINANCE','MANAGEMENT','SUPPORT'), getCompanyStats)
router.post('/:id/notes', authorize('ALL' as any), addCompanyNote)
router.get('/:id/notes', authorize('ALL' as any), listCompanyNotes)
router.post('/upload', authorize('ADMIN','TRADING','MANAGEMENT','SUPPORT'), upload.single('file'), uploadCompanies)

export default router


