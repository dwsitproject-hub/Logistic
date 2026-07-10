# KLIP System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Next.js 14 + React 18 + TypeScript           │   │
│  │                                                       │   │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────┐  │   │
│  │  │Dashboard│  │Contracts│ │Shipments│ │Shipping  │  │   │
│  │  │         │  │         │ │         │ │Performance│  │   │
│  │  └────────┘  └────────┘  └────────┘  └──────────┘  │   │
│  │                                                       │   │
│  │  UI Components: shadcn/ui + Tailwind CSS             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ REST API (JSON)
                              │ JWT Authentication
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend Layer                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Node.js + Express + TypeScript              │   │
│  │                                                       │   │
│  │  ┌────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │ Controllers│  │  Middleware  │  │  Services  │  │   │
│  │  └────────────┘  └──────────────┘  └────────────┘  │   │
│  │       │                 │                  │         │   │
│  │       ├─ Auth          ├─ JWT Auth         │         │   │
│  │       ├─ Contracts     ├─ RBAC             │         │   │
│  │       ├─ Shipments     ├─ Error Handler    │         │   │
│  │       ├─ Finance       ├─ Logging          │         │   │
│  │       ├─ Documents     └─ Validation       │         │   │
│  │       └─ Dashboard                          │         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ SQL Queries
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Database Layer                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   PostgreSQL 14+                      │   │
│  │                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│   │
│  │  │ Contracts│ │ Shipments│ │ Payments │ │Documents││   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘│   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│   │
│  │  │  Quality │ │  Users   │ │AuditLogs │ │AI Insight││   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Future Integration
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Systems (Future)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  SAP ERP    │  Email SMTP  │  AI/ML Service         │   │
│  │  (OData API)│  (Alerts)    │  (Python/scikit-learn) │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Frontend Architecture

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Home page (redirect)
│   │   ├── login/              # Authentication
│   │   ├── dashboard/          # Main dashboard
│   │   ├── contracts/          # Contract management
│   │   ├── shipments/          # Shipment tracking
│   │   ├── shipping-performance/# Shipment performance analytics
│   │   ├── finance/            # Payment management
│   │   ├── documents/          # Document repository
│   │   ├── users/              # User management
│   │   └── audit/              # Audit logs
│   │
│   ├── components/             # Reusable components
│   │   ├── Layout.tsx          # Main app layout with sidebar
│   │   └── ui/                 # shadcn/ui components
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       └── ...
│   │
│   └── lib/                    # Utilities
│       ├── api.ts              # Axios API client
│       └── utils.ts            # Helper functions
│
└── public/                     # Static assets
```

### Backend Architecture

```
backend/
├── src/
│   ├── server.ts              # Application entry point
│   │
│   ├── controllers/           # Request handlers
│   │   ├── auth.controller.ts
│   │   └── contract.controller.ts
│   │
│   ├── routes/                # API route definitions
│   │   ├── auth.routes.ts
│   │   ├── contract.routes.ts
│   │   ├── shipment.routes.ts
│   │   ├── finance.routes.ts
│   │   ├── document.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── user.routes.ts
│   │   └── audit.routes.ts
│   │
│   ├── middleware/            # Express middleware
│   │   ├── auth.ts            # JWT authentication
│   │   ├── errorHandler.ts   # Error handling
│   │   └── notFoundHandler.ts
│   │
│   ├── database/              # Database layer
│   │   ├── connection.ts      # PostgreSQL connection pool
│   │   ├── schema.sql         # Database schema
│   │   ├── migrate.ts         # Migration runner
│   │   └── seed.ts            # Data seeder
│   │
│   └── utils/                 # Utilities
│       └── logger.ts          # Winston logger
│
└── uploads/                   # File uploads directory
```

## Data Flow

### Authentication Flow

```
1. User enters credentials
   ↓
2. Frontend sends POST /api/auth/login
   ↓
3. Backend verifies credentials
   ↓
4. Backend generates JWT token
   ↓
5. Frontend stores token in localStorage
   ↓
6. Frontend includes token in subsequent requests
   ↓
7. Backend middleware validates token
   ↓
8. Request processed or rejected
```

### Contract Creation Flow

```
1. User fills contract form
   ↓
2. Frontend validates input
   ↓
3. Frontend sends POST /api/contracts with JWT
   ↓
4. Backend authenticates user
   ↓
5. Backend authorizes role (ADMIN/TRADING)
   ↓
6. Backend validates data
   ↓
7. Backend inserts into database
   ↓
8. Audit log created
   ↓
9. Success response to frontend
   ↓
10. Frontend updates UI
```

### Data Sync Flow (Future SAP Integration)

```
1. Cron job triggers at 7:00 AM
   ↓
2. Backend calls SAP OData API
   ↓
3. Fetch contracts, deliveries, payments
   ↓
4. Transform SAP data to KLIP format
   ↓
5. Upsert data into PostgreSQL
   ↓
6. Calculate gain/loss automatically
   ↓
7. Trigger AI analysis
   ↓
8. Generate insights and alerts
   ↓
9. Send email notifications
   ↓
10. Log sync status
```

## Security Architecture

### Authentication & Authorization

1. **JWT Token-based Authentication**
   - Tokens expire after 7 days (configurable)
   - Secure token storage in localStorage
   - Automatic logout on token expiration

2. **Role-Based Access Control (RBAC)**
   - Six user roles with specific permissions
   - Middleware-level authorization checks
   - Frontend route protection

3. **Password Security**
   - Bcrypt hashing with 10 salt rounds
   - Passwords never stored in plain text
   - Secure password reset flow

### API Security

1. **Helmet.js**: Security headers
2. **CORS**: Cross-origin resource sharing control
3. **Rate Limiting**: (To be implemented)
4. **Input Validation**: Express-validator
5. **SQL Injection Prevention**: Parameterized queries

### Data Security

1. **Encryption in Transit**: HTTPS/TLS (production)
2. **Encryption at Rest**: PostgreSQL encryption (optional)
3. **Audit Logging**: Complete activity tracking
4. **Access Control**: Role-based data visibility

## Scalability Considerations

### Horizontal Scaling

- **Frontend**: Stateless Next.js - can run multiple instances
- **Backend**: Stateless API - can run multiple instances behind load balancer
- **Database**: PostgreSQL replication and read replicas

### Performance Optimization

1. **Database**:
   - Proper indexing on frequently queried columns
   - Connection pooling (max 20 connections)
   - Query optimization

2. **Backend**:
   - Response compression (gzip)
   - Efficient SQL queries
   - Pagination for large datasets

3. **Frontend**:
   - Code splitting
   - Image optimization
   - Lazy loading
   - Client-side caching

## Monitoring & Logging

### Logging Levels

- **ERROR**: Application errors
- **WARN**: Warning conditions
- **INFO**: Informational messages
- **DEBUG**: Debug-level messages (development only)

### Log Storage

- **Development**: Console output
- **Production**: 
  - `logs/error.log`: Error logs
  - `logs/combined.log`: All logs
  - Consider external logging service (e.g., CloudWatch, Datadog)

### Monitoring Metrics

Key metrics to monitor:

1. **Application**:
   - Request rate
   - Response time
   - Error rate
   - Active users

2. **Database**:
   - Connection pool usage
   - Query performance
   - Database size
   - Slow queries

3. **Business**:
   - Active contracts
   - Shipments in transit
   - Payment completion rate
   - User activity

## API Architecture

### RESTful API Design

**Base URL**: `http://localhost:5000/api`

**Authentication**: Bearer token in Authorization header

**Response Format**:
```json
{
  "success": true,
  "data": {
    // Response payload
  }
}
```

**Error Response Format**:
```json
{
  "success": false,
  "error": {
    "message": "Error description"
  }
}
```

### API Endpoints

#### Authentication
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - User login
- GET `/api/auth/profile` - Get user profile
- PUT `/api/auth/profile` - Update profile

#### Contracts
- GET `/api/contracts` - List contracts (with pagination)
- GET `/api/contracts/:id` - Get contract details
- POST `/api/contracts` - Create contract
- PUT `/api/contracts/:id` - Update contract

#### Shipments
- GET `/api/shipments` - List shipments
- GET `/api/shipments/performance` - Shipping performance metrics (SEA/MIX)
- GET `/api/shipments/:id` - Get shipment details
- POST `/api/shipments` - Create shipment
- PUT `/api/shipments/:id` - Update shipment

#### Shipping Performance Design Notes
- Dataset is derived from `shipments` + `contracts` + `vessel_loading_ports` (+ latest `sap_processed_data` for `contract_ext_no`).
- Loading/Discharge delta metrics are computed server-side and returned as day-difference fields.
- Late Performance drilldown on UI uses hierarchy: `Total -> Incoterm -> Product -> Plant`.
- Late/On-time filter semantics:
  - `LATE` => `total_delta_days > 0`
  - `ON_TIME` => `total_delta_days <= 0`
- Table UX follows Contracts/Shipments patterns: configurable columns, header filter popovers, sortable headers, and drag-reorder.

#### Finance
- GET `/api/finance/payments` - List payments
- GET `/api/finance/payments/:id` - Get payment details
- POST `/api/finance/payments` - Create payment
- PUT `/api/finance/payments/:id` - Update payment

#### Documents
- GET `/api/documents` - List documents
- POST `/api/documents/upload` - Upload document
- GET `/api/documents/:id/download` - Download document
- DELETE `/api/documents/:id` - Delete document

#### Dashboard
- GET `/api/dashboard/stats` - Get dashboard statistics
- GET `/api/dashboard/kpis` - Get KPI metrics
- GET `/api/dashboard/insights` - Get AI insights

#### Users (Admin only)
- GET `/api/users` - List users
- POST `/api/users` - Create user
- PUT `/api/users/:id` - Update user
- DELETE `/api/users/:id` - Deactivate user

#### Audit Logs (Admin/Support only)
- GET `/api/audit` - Get audit logs

## Database Architecture

### Connection Pooling

```typescript
Pool Configuration:
- max: 20 connections
- idleTimeoutMillis: 30000
- connectionTimeoutMillis: 2000
```

### Transaction Management

For operations requiring multiple database changes:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Multiple queries
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Query Optimization

1. Use indexes for frequently queried columns
2. Use LIMIT and OFFSET for pagination
3. Avoid N+1 queries with JOIN operations
4. Use prepared statements for repeated queries

## State Management

### Frontend State

- **Local State**: React useState for component state
- **Global State**: Zustand (optional, for user/auth state)
- **Server State**: SWR or React Query (future enhancement)
- **Form State**: React Hook Form

### Backend State

- **Stateless API**: No server-side session storage
- **JWT Tokens**: Client-side state management
- **Database**: Single source of truth

## Integration Points

### SAP Integration (Future)

```
KLIP Backend → SAP OData API
  │
  ├── Contracts (SAP SD)
  ├── Deliveries (SAP MM)
  ├── Quality (SAP QM)
  ├── Payments (SAP FI)
  └── Master Data
```

**Integration Methods**:
1. **REST API**: SAP OData services
2. **Middleware**: SAP PI/PO
3. **Direct DB**: SAP HANA (if permitted)

### Future Integrations

1. **Email Service**: SMTP for alerts and notifications
2. **AI/ML Service**: Python microservice for advanced analytics
3. **Document Storage**: AWS S3 or Azure Blob Storage
4. **Shipping APIs**: Real-time vessel tracking
5. **Weather APIs**: Route planning optimization

## Deployment Architecture

### Development Environment

```
Developer Machine
├── Frontend: localhost:3000
├── Backend: localhost:5000
└── PostgreSQL: localhost:5432
```

### Production Environment (Recommended)

```
Cloud Infrastructure (AWS/Azure)
│
├── Load Balancer
│   │
│   ├── Frontend (Multiple instances)
│   │   └── Next.js on Vercel/AWS Amplify
│   │
│   └── Backend (Multiple instances)
│       └── Node.js on EC2/App Service
│
├── Database
│   └── PostgreSQL RDS/Azure Database
│
├── File Storage
│   └── S3/Azure Blob Storage
│
└── CDN
    └── CloudFront/Azure CDN
```

## Performance Benchmarks

### Target Metrics

- **API Response Time**: < 200ms (p95)
- **Page Load Time**: < 2s (p95)
- **Database Query Time**: < 50ms (p95)
- **Concurrent Users**: 100+
- **Throughput**: 1000 req/min

### Optimization Strategies

1. **Database**: Indexing, query optimization, connection pooling
2. **API**: Compression, caching, pagination
3. **Frontend**: Code splitting, lazy loading, CDN
4. **Infrastructure**: Auto-scaling, load balancing

## Disaster Recovery

### Backup Strategy

1. **Database**:
   - Daily full backups
   - Transaction log backups every 4 hours
   - Retention: 30 days

2. **Documents**:
   - Replicated to backup storage
   - Versioning enabled

3. **Configuration**:
   - Environment variables backed up securely
   - Infrastructure as Code (IaC)

### Recovery Procedures

1. **Database Failure**: Restore from latest backup
2. **Application Failure**: Redeploy from Git repository
3. **Data Corruption**: Point-in-time recovery

### RTO and RPO

- **Recovery Time Objective (RTO)**: < 4 hours
- **Recovery Point Objective (RPO)**: < 1 hour

## Future Enhancements

### Phase 2: Enhanced Analytics
- Advanced charting with D3.js
- Custom report builder
- Data export scheduler
- Email report delivery

### Phase 3: AI/ML Integration
- Predictive analytics microservice
- Machine learning models for:
  - Demand forecasting
  - Route optimization
  - Price prediction
  - Anomaly detection

### Phase 4: Mobile & IoT
- Mobile app (React Native)
- IoT sensor integration
- Real-time GPS tracking
- Barcode/QR code scanning

### Phase 5: Advanced Features
- Blockchain for document verification
- Multi-currency support
- Multi-language interface
- Advanced workflow automation
- Custom business rules engine

## Development Best Practices

1. **Code Organization**: Modular, reusable components
2. **Type Safety**: TypeScript throughout
3. **Error Handling**: Comprehensive error catching
4. **Logging**: Structured logging with Winston
5. **Testing**: Unit and integration tests (to be added)
6. **Documentation**: Inline comments, API documentation
7. **Version Control**: Git with meaningful commits
8. **Code Review**: Pull request workflow

## Technology Choices Rationale

### Why Next.js?
- Server-side rendering for better SEO
- File-based routing
- Built-in optimization
- Great developer experience

### Why Express?
- Lightweight and flexible
- Large ecosystem
- Easy to understand
- Good performance

### Why PostgreSQL?
- ACID compliance
- Complex query support
- JSON/JSONB support
- Excellent performance
- Open source

### Why TypeScript?
- Type safety
- Better IDE support
- Fewer runtime errors
- Self-documenting code

### Why Tailwind CSS?
- Utility-first approach
- Consistent design
- Small bundle size
- Easy customization

## Conclusion

The KLIP architecture is designed to be:
- **Scalable**: Handle growing data and users
- **Secure**: Multiple layers of security
- **Maintainable**: Clean code organization
- **Extensible**: Easy to add new features
- **Performant**: Optimized for speed

For questions or suggestions, please contact the development team.

