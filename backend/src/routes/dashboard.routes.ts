import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { 
  getDashboardStats, 
  getTopSuppliers, 
  getTopTruckingOwners, 
  getTopVessels,
  getShipmentsByStatus,
  getTruckingOperationsByStatus,
  getContractQuantityByProduct,
  getContractQuantityByPlant,
  getContractQuantityByIncoterm,
  getPlantDetails,
  getProductDetails,
  getIncotermDetails,
  getFilterPlants,
  getFilterSuppliers,
  getFilteredContracts
} from '../controllers/dashboard.controller';

const router = express.Router();

router.use(authenticateToken);

// Dashboard statistics
router.get('/stats', getDashboardStats);

// Top performers
router.get('/top-suppliers', getTopSuppliers);
router.get('/top-trucking-owners', getTopTruckingOwners);
router.get('/top-vessels', getTopVessels);

// Detail views for clickable sections
// Contracts list (filtered)
router.get('/contracts', getFilteredContracts);
router.get('/shipments', getShipmentsByStatus);
router.get('/trucking-operations', getTruckingOperationsByStatus);

// New dashboard widgets
router.get('/contract-quantity-by-product', getContractQuantityByProduct);
router.get('/contract-quantity-by-plant', getContractQuantityByPlant);
router.get('/contract-quantity-by-incoterm', getContractQuantityByIncoterm);
router.get('/plant-details', getPlantDetails);
router.get('/product-details', getProductDetails);
router.get('/incoterm-details', getIncotermDetails);

// Filter options
router.get('/filter-options/plants', getFilterPlants);
router.get('/filter-options/suppliers', getFilterSuppliers);

export default router;

