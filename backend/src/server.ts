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

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server (skipped in automated tests so Vitest can import `app` without binding a port)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`🚀 Server is running on port ${PORT}`);
    logger.info(`📚 API Documentation available at http://localhost:${PORT}/api-docs`);

    try {
      SchedulerService.initialize();
      logger.info('📅 Scheduler service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler service:', error);
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  SchedulerService.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  SchedulerService.shutdown();
  process.exit(0);
});

export default app;

