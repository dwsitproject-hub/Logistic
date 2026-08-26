// First thing: ensure Docker logs show we started (before any logger that might fail)
if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
  process.stdout.write('[klip-backend] Node process starting...\n');
}
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import logger from './utils/logger';
import { runWarmupJobsSequentially } from './utils/startupWarmupQueue';
import {
  startShipmentListShellCacheWarmer,
  startShipmentOutstandingQtyCacheWarmer,
  startShipmentScopedToolbarCacheWarmer,
  startShipmentSummaryCacheWarmer,
} from './services/shipmentSummaryWarmer.service';
import { SchedulerService } from './services/scheduler.service';
import { PipelineDailySummaryService, isPipelineDailySummaryFresh } from './services/pipelineDailySummary.service';
import { ContractQtyMoveSnapshotService, isContractQtyMoveSnapshotFresh } from './services/contractQtyMoveSnapshot.service';
import { ContractStoAggSnapshotService, isContractStoAggSnapshotFresh } from './services/contractStoAggSnapshot.service';
import { ContractLatestSpdSnapshotService, isContractLatestSpdSnapshotFresh } from './services/contractLatestSpdSnapshot.service';
import { B2bEndingChildSnapshotService, isB2bEndingChildSnapshotFresh } from './services/b2bEndingChildSnapshot.service';
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
import alertRoutes from './routes/alert.routes';
import agentAiRoutes from './routes/agentAi.routes';
import oilLossRoutes from './routes/oilLoss.routes';
import commercialDocumentsRoutes from './routes/commercialDocuments.routes';
import aiKlipAgentActivityRoutes from './routes/aiKlipAgentActivity.routes';
import userActivityLogRoutes from './routes/userActivityLog.routes';
import prePlannedRoutes from './routes/prePlanned.routes';
import { ssoHubHandler } from './controllers/sso.controller';
import { oidcLoginHandler, oidcCallbackHandler, isOidcConfigured } from './controllers/oidc.controller';
import { configureTrustProxy, createSessionMiddleware } from './middleware/session';
import { frontendUrl } from './services/sessionAuth.service';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '50mb';

configureTrustProxy(app);

// Middleware — disable COOP on HTTP (browser ignores it anyway; noisy on SSO redirects)
app.use(
  helmet({
    crossOriginOpenerPolicy: process.env.SESSION_COOKIE_SECURE === 'true',
  }),
);
const corsOrigin = frontendUrl();
const extraCorsOrigins = String(process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, '');
      const allowed = new Set(
        [
          corsOrigin,
          process.env.APP_PUBLIC_ORIGIN?.replace(/\/$/, ''),
          'http://localhost:3001',
          'http://127.0.0.1:3001',
          ...extraCorsOrigins,
        ].filter(Boolean) as string[],
      );
      callback(null, allowed.has(normalized));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(cookieParser());
app.use(createSessionMiddleware());
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

// Downstream Hub SSO — legacy HS256 bridge (opt-in via SSO_LEGACY_BRIDGE=true).
if (process.env.SSO_LEGACY_BRIDGE === 'true') {
  app.post('/auth/hub', ssoHubHandler);
}

// OIDC SSO (Authorization Code + PKCE) — primary integration path.
if (isOidcConfigured()) {
  app.get('/auth/oidc/login', oidcLoginHandler);
  app.get('/auth/oidc/callback', oidcCallbackHandler);
} else {
  app.get('/auth/oidc/login', (_req, res) => {
    res.status(503).json({ success: false, error: { message: 'OIDC SSO is not configured' } });
  });
  app.get('/auth/oidc/callback', (_req, res) => {
    res.status(503).json({ success: false, error: { message: 'OIDC SSO is not configured' } });
  });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/trucking', truckingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/alerts', alertRoutes);
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
app.use('/api/pre-planned', prePlannedRoutes);

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

    void import('./services/prePlannedGroup.service')
      .then(({ schedulePrePlannedRebuildIfEnabled }) => schedulePrePlannedRebuildIfEnabled('startup'))
      .catch((error) => logger.warn('Pre-planned startup rebuild skipped', { error }));

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
        if (!(await isB2bEndingChildSnapshotFresh())) {
          logger.info('B2B ending-child snapshot stale — refreshing in background');
          await B2bEndingChildSnapshotService.refreshAll();
        }
      } catch (error) {
        logger.warn('Pipeline daily summary startup refresh skipped', { error });
      }
    });

    /*
     * Warm the page caches ONE AT A TIME.
     *
     * These used to be scheduled at fixed 0s / 20s / 40s offsets, which guesses at how long each
     * job takes. When the guess is wrong they overlap, and each one is a heavy
     * sap_processed_data scan. On staging (2026-08-06) that produced load average 16.77 on
     * 2 vCPUs with five concurrent queries of 87-130s, two deadlocked on LWLock, and an 80s cold
     * Trucking page.
     *
     * The queue starts each job only after the previous finishes, so at most one heavy query is
     * in flight however slow any single one turns out to be. Wall-clock warm-up is longer, which
     * is the right trade: nothing waits on the warmers, but the requests they were competing
     * with do have a user waiting.
     *
     * Shipments is warmed here for the first time. Its two summary calls were the only heavy
     * page calls with no warmer at all, costing the first visitor after each restart ~25s on the
     * most-used page (measured: summaryOnly 16.8s, outstandingQtyOnly 8.3s).
     *
     * Ordering is by how likely a page is to be opened first, so the earliest visitor benefits
     * most. Nothing about what any warmer computes or returns changes.
     */
    void runWarmupJobsSequentially(
      [
        { name: 'Shipping Performance', run: () => startShippingPerformanceCacheWarmer() },
        { name: 'Shipments list shell', run: () => startShipmentListShellCacheWarmer() },
        { name: 'Shipments summary', run: () => startShipmentSummaryCacheWarmer() },
        { name: 'Shipments outstanding qty', run: () => startShipmentOutstandingQtyCacheWarmer() },
        {
          name: 'Shipments scoped toolbar (plant×product)',
          run: () => startShipmentScopedToolbarCacheWarmer(),
        },
        { name: 'Trucking summary', run: () => startTruckingListCacheWarmer() },
        { name: 'Oil Loss', run: () => startOilLossCacheWarmer() },
      ],
      {
        // Let the app finish booting and serve any waiting request before we add DB load.
        initialDelayMs: 5_000,
        gapMs: 5_000,
      },
    );
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

