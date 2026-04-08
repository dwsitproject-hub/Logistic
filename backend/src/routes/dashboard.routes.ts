import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { 
  getDashboardStats, 
  getTopSuppliers, 
  getTopTruckingOwners, 
  getTopVessels,
  getShipmentsByStatus,
  getTruckingOperationsByStatus,
  getPaymentsByStatus,
  getContractQuantityByProduct,
  getContractQuantityByProductIncoterm,
  getContractQuantityByProductIncotermPlantSource,
  getContractQuantityByPlant,
  getContractQuantityByPlantIncoterm,
  getContractQuantityByIncoterm,
  getPlantDetails,
  getProductDetails,
  getIncotermDetails,
  getFilterPlants,
  getFilterSuppliers,
  getFilterProducts,
  getFilterGroups,
  getFilteredContracts,
  getDashboardAiInsight,
  generateDashboardAiInsight,
  getClaimMutuOutstandingRows,
  getClaimSusutOutstandingRows,
} from '../controllers/dashboard.controller';

const router = express.Router();

router.use(authenticateToken);

// Dashboard statistics
router.get('/stats', getDashboardStats);
router.get('/claim-mutu-outstanding', getClaimMutuOutstandingRows);
router.get('/claim-susut-outstanding', getClaimSusutOutstandingRows);

// AI Insights
router.get('/ai-insight', getDashboardAiInsight);
router.post('/ai-insight', generateDashboardAiInsight);

// Top performers
router.get('/top-suppliers', getTopSuppliers);
router.get('/top-trucking-owners', getTopTruckingOwners);
router.get('/top-vessels', getTopVessels);

// Detail views for clickable sections
// Contracts list (filtered)
router.get('/contracts', getFilteredContracts);
router.get('/shipments', getShipmentsByStatus);
router.get('/trucking-operations', getTruckingOperationsByStatus);
router.get('/payments', getPaymentsByStatus);

// New dashboard widgets
router.get('/contract-quantity-by-product', getContractQuantityByProduct);
router.get('/contract-quantity-by-product-incoterm', getContractQuantityByProductIncoterm);
router.get('/contract-quantity-by-product-incoterm-plant-source', getContractQuantityByProductIncotermPlantSource);
router.get('/contract-quantity-by-plant', getContractQuantityByPlant);
router.get('/contract-quantity-by-plant-incoterm', getContractQuantityByPlantIncoterm);
router.get('/contract-quantity-by-incoterm', getContractQuantityByIncoterm);
router.get('/plant-details', getPlantDetails);
router.get('/product-details', getProductDetails);
router.get('/incoterm-details', getIncotermDetails);

// Filter options
router.get('/filter-options/plants', getFilterPlants);
router.get('/filter-options/suppliers', getFilterSuppliers);
router.get('/filter-options/products', getFilterProducts);
router.get('/filter-options/groups', getFilterGroups);

export default router;

