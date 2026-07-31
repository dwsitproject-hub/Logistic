// First thing: ensure Docker logs show we started (before any logger that might fail)
if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
  process.stdout.write('[klip-backend] Node process starting...\n');
}
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import logger from './utils/logger';
import { SchedulerService } from './services/scheduler.service';
import { PipelineDailySummaryService, isPipelineDailySummaryFresh } from './services/pipelineDailySummary.service';
import { ContractQtyMoveSnapshotService, isContractQtyMoveSnapshotFresh } from './services/contractQtyMoveSnapshot.service';
import { ContractStoAggSnapshotService, isContractStoAggSnapshotFresh } from './services/contractStoAggSnapshot.service';
import { ContractLatestSpdSnapshotService, isContractLatestSpdSnapshotFresh } from './services/contractLatestSpdSnapshot.service';
import { ensureUserStoContractAssignmentsTable } from './database/ensureUserStoContractAssignments';
import {
  startShippingPerformanceCacheWarmer,
  stopShippingPerformanceCacheWarmer,
} from './services/shippingPerformance.service';
import { startOilLossCacheWarmer } from './services/oilLoss.service';
import { startTruckingListCacheWarmer } from './services/truckingList.service';

// Import routes
import authRoutes from './routes/auth.routes';
import contractRoutes from './routes/contract.routes';
import shipmentRoutes from './routes/shipment.routes';
import truckingRoutes from './routes/trucking.routes';
import financeRoutes from './routes/finance.routes';
import documentRoutes from './routes/document.routes';
import dashboardRoutes from './routes/dashboard.routes';
import userRoutes from './routes/user.routes';
import roleRoutes from './routes/role.routes';
import masterVesselRoutes from './routes/masterVessel.routes';
import masterLoadingPortRoutes from './routes/masterLoadingPort.routes';
import masterPlantRoutes from './routes/masterPlant.routes';
import auditRoutes from './routes/audit.routes';
import sapRoutes from './routes/sap.routes';
import excelImportRoutes from './routes/excelImport.routes';
import sapMasterV2Routes from './routes/sapMasterV2.routes';
import supplierRoutes from './routes/supplier.routes';
import supplierGroupsRoutes from './routes/supplier-groups.routes';
import productRoutes from './routes/product.routes';
import companyRoutes from './routes/company.routes';
import claimMutuRoutes from './routes/claimMutu.routes';
import claimSusutRoutes from './routes/claimSusut.routes';
import userPreferencesRoutes from './routes/userPreferences.routes';
import activityRoutes from './routes/activity.routes';
import agentAiRoutes from './routes/agentAi.routes';
import oilLossRoutes from './routes/oilLoss.routes';
import commercialDocumentsRoutes from './routes/commercialDocuments.routes';
import aiKlipAgentActivityRoutes from './routes/aiKlipAgentActivity.routes';
import userActivityLogRoutes from './routes/userActivityLog.routes';
import { ssoHubHandler } from './controllers/sso.controller';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '50mb';

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'KLIP API Documentation',
      version: '1.0.0',
      description: 'KPN Logistics Intelligence Platform API',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check (also under /api for Nginx proxy: /api/health → backend /api/health)
app.get('/health', (_req, res) => {
  res.json({ status: 'OK', message: 'KLIP Backend is running' });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', message: 'KLIP Backend is running' });
});

// Downstream Hub SSO handoff — unauthenticated, outside /api (Hub posts here directly).
app.post('/auth/hub', ssoHubHandler);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/trucking', truckingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/agent-ai', agentAiRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/master-vessels', masterVesselRoutes);
app.use('/api/master-loading-ports', masterLoadingPortRoutes);
app.use('/api/master-plants', masterPlantRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/sap', sapRoutes);
app.use('/api/excel-import', excelImportRoutes);
app.use('/api/sap-master-v2', sapMasterV2Routes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/supplier-groups', supplierGroupsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/claim-mutu', claimMutuRoutes);
app.use('/api/claim-susut', claimSusutRoutes);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/oil-loss', oilLossRoutes);
app.use('/api/commercial-documents', commercialDocumentsRoutes);
app.use('/api/ai-klip-agent-activity', aiKlipAgentActivityRoutes);
app.use('/api/user-activity', userActivityLogRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server (skipped in automated tests so Vitest can import `app` without binding a port)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    logger.info(`🚀 Server is running on port ${PORT}`);
    logger.info(`📚 API Documentation available at http://localhost:${PORT}/api-docs`);

    try {
      await ensureUserStoContractAssignmentsTable();
    } catch (error) {
      logger.error('Failed to ensure user_sto_contract_assignments table:', error);
    }

    try {
      SchedulerService.initialize();
      logger.info('📅 Scheduler service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler service:', error);
    }

    setImmediate(async () => {
      try {
        const [truckingFresh, shipmentFresh, qtySnapshotFresh, stoAggSnapshotFresh, latestSpdSnapshotFresh] =
          await Promise.all([
          isPipelineDailySummaryFresh('trucking'),
          isPipelineDailySummaryFresh('shipment'),
          isContractQtyMoveSnapshotFresh(),
          isContractStoAggSnapshotFresh(),
          isContractLatestSpdSnapshotFresh(),
        ]);
        if (!truckingFresh || !shipmentFresh) {
          logger.info('Pipeline daily summaries stale — refreshing in background');
          await PipelineDailySummaryService.refreshAll();
        }
        if (!qtySnapshotFresh) {
          logger.info('Contract qty_move snapshot stale — refreshing in background');
          await ContractQtyMoveSnapshotService.refreshAll();
        }
        if (!stoAggSnapshotFresh) {
          logger.info('Contract sto_agg snapshot stale — refreshing in background');
          await ContractStoAggSnapshotService.refreshAll();
        }
        if (!latestSpdSnapshotFresh) {
          logger.info('Contract latest_spd snapshot stale — refreshing in background');
          await ContractLatestSpdSnapshotService.refreshAll();
        }
      } catch (error) {
        logger.warn('Pipeline daily summary startup refresh skipped', { error });
      }
    });

    // Warm the Shipping Performance row cache so the first visitor after a restart
    // is served from memory instead of paying the full query cost.
    try {
      startShippingPerformanceCacheWarmer();
      logger.info('🔥 Shipping Performance cache warmer started');
    } catch (error) {
      logger.warn('Failed to start Shipping Performance cache warmer', { error });
    }

    /*
     * Stagger the remaining warmers.
     *
     * All three used to fire at once, and each runs a heavy sap_processed_data scan. A visitor
     * arriving seconds after a restart landed in that contention window and waited 13-18s for
     * Shipping Performance - far longer than the ~3.5s the query costs on its own. Shipping
     * Performance starts immediately (above) and the other two follow behind it, so the first
     * page load competes with nothing. Nothing about what they compute changes.
     */
    const WARMER_STAGGER_MS = 20 * 1000;

    // Warm the Oil Loss cache (two full sap_processed_data JSONB scans) for the same reason.
    setTimeout(() => {
      try {
        startOilLossCacheWarmer();
        logger.info('🔥 Oil Loss cache warmer started');
      } catch (error) {
        logger.warn('Failed to start Oil Loss cache warmer', { error });
      }
    }, WARMER_STAGGER_MS).unref?.();

    // Warm the Trucking default-scope summary (status circles + Outstanding Qty).
    setTimeout(() => {
      try {
        startTruckingListCacheWarmer();
        logger.info('🔥 Trucking summary cache warmer started');
      } catch (error) {
        logger.warn('Failed to start Trucking summary cache warmer', { error });
      }
    }, WARMER_STAGGER_MS * 2).unref?.();
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  SchedulerService.shutdown();
  stopShippingPerformanceCacheWarmer();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  SchedulerService.shutdown();
  stopShippingPerformanceCacheWarmer();
  process.exit(0);
});

export default app;

