## KLIP (KPN Logistics Intelligence Platform)

Web-based logistics management system for SAP-integrated contract, shipment, trucking, finance, documents, and audit workflows.

## Tech stack (current)

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind
- **Backend**: Node.js + Express, TypeScript
- **Database**: PostgreSQL
- **Auth**: JWT + role-based access control (RBAC)

## Repository layout (current)

```
.
├── frontend/                      # Next.js app (runs on :3001)
└── backend/                       # Express API (runs on :5001)
    └── src/database/migrations/   # SQL migrations applied by `npm run db:migrate`
```

## Quick start (local dev)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Install

```bash
npm run install:all
```

### Environment variables

**Frontend** (`frontend/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

**Backend** (`backend/.env`):

```env
PORT=5001
NODE_ENV=development
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=1d

DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=your-db-password
```

### Create DB + run migrations + seed

```bash
cd backend
npm run db:migrate
npm run db:seed
```

### Run the app

```bash
npm run dev
```

### Default URLs (local)

- Frontend: `http://localhost:3001`
- Backend API: `http://localhost:5001/api`

## User Roles

- **Trading**: Track gain/loss and contract performance
- **Logistics Operations**: Monitor shipments and SLA
- **Finance**: Payment status and verification
- **Management**: Executive dashboard with AI insights
- **Admin Support**: Data validation and audit logs
- **IT/System Admin**: User management and integration monitoring

## Key Modules

1. **Dashboard**: Overview with KPIs and AI insights
2. **Contracts**: Contract management and tracking
3. **Shipments**: Shipment tracker with gain/loss monitoring
4. **Finance**: Payment status and proof upload
5. **Documents**: Upload and manage supporting documents
6. **SAP Import**: Excel file upload and data processing
7. **Administration**: User management and audit logs

## SAP Upload Mechanism

### Overview

The SAP upload mechanism allows administrators to import daily SAP data from Excel files (MASTER v2 format) into the system. The system automatically processes, validates, and distributes data to the appropriate database tables.

### Upload Flow

```
1. File Upload → 2. Excel Parsing → 3. Field Mapping → 4. Data Validation → 5. Distribution → 6. Table Updates
```

#### Step-by-Step Process

1. **File Upload** (`POST /api/sap-master-v2/import-upload`)
   - Admin uploads Excel file (.xlsx or .xls)
   - File validation (max 50MB, Excel format only)
   - File temporarily stored in `backend/uploads/`
   - Requires ADMIN role authorization

2. **Import Initialization**
   - Creates import record in `sap_data_imports` table
   - Status set to 'processing'
   - Import ID generated for tracking

3. **Excel Parsing** (`SapMasterV2ImportService`)
   - Reads Excel file using XLSX library
   - Locates "MASTER v2" sheet
   - Extracts metadata from header rows:
     - Row 1: Field headers (display names)
     - Row 2-3: User role legends (TRADING, LOGISTICS, FINANCE, etc.)
     - Row 4-5: SAP source field mappings
   - Processes data rows starting from Row 2

4. **Field Metadata Parsing**
   - Normalizes field names (removes line breaks, extra spaces)
   - Maps Excel columns to database fields
   - Categorizes fields by type (Contract, Shipment, Quality, Trucking, Payment, Vessel)
   - Identifies SAP vs manual vs calculated fields

5. **Data Row Processing** (Per Row)
   - Stores raw data in `sap_raw_data` table (JSONB format)
   - Parses row into structured object:
     ```typescript
     {
       contract: {...},      // Contract fields
       shipment: {...},      // Shipment/STO fields
       quality: [...],       // Quality survey data (multiple locations)
       trucking: [...],      // Trucking operations (multiple sequences)
       payment: {...},       // Payment fields
       vessel: {...},        // Vessel details
       raw: {...}            // All original fields
     }
     ```
   - Checks for duplicate entries (Contract + PO + STO tri-key)
   - Updates existing records if duplicate found

6. **Data Storage**
   - Stores processed data in `sap_processed_data` table
   - Includes key identifiers: contract_number, po_number, sto_number
   - Full structured data stored as JSONB

7. **Data Distribution** (`SapDataDistributionService`)
   - Routes data to appropriate tables based on transport mode (SEA/LAND)
   - Creates/updates records in:
     - `contracts` table
     - `shipments` table (if SEA transport)
     - `trucking_operations` table (if LAND transport or additional trucking)
     - `quality_surveys` table (multiple locations for SEA shipments)
     - `payments` table
     - `vessel_loading_ports` table (for multi-port loading)

8. **Error Handling**
   - Each row processed in a SAVEPOINT transaction
   - Failed rows marked with error messages
   - Processing continues even if individual rows fail
   - Import status updated: 'completed' or 'completed_with_errors'

9. **Cleanup**
   - Temporary uploaded file deleted after processing
   - Import summary returned with statistics

### Table Mapping

#### SAP Integration Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `sap_data_imports` | Tracks import sessions | `id`, `import_date`, `status`, `total_records`, `processed_records`, `failed_records` |
| `sap_raw_data` | Stores raw imported data | `id`, `import_id`, `row_number`, `data` (JSONB), `status`, `error_message` |
| `sap_processed_data` | Normalized processed data | `id`, `import_id`, `contract_number`, `po_number`, `sto_number`, `data` (JSONB) |

#### Domain Table Mappings

##### Contracts Table
SAP data maps to `contracts` table:

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Contract No. | Primary identifier |
| `po_number` | PO No. | Purchase order number |
| `supplier` | Supplier (Vendor) | From LFA1-NAME1 |
| `product` | Product (Material Desc) | From ZTCONF_COMM_MAT |
| `contract_date` | Contract Date | Same as PO Date |
| `quantity_ordered` | Contract Quantity | Can also be PO Qty |
| `unit_price` | Unit Price | From PRCD_ELEMENTS |
| `contract_value` | Calculated | quantity × unit_price |
| `incoterm` | Incoterm | At starting point |
| `transport_mode` | Sea / Land | SEA or LAND |
| `delivery_start_date` | Due Date Delivery (Start) | |
| `delivery_end_date` | Due Date Delivery (End) | |
| `source_type` | Source (3rd Party/Inhouse) | |
| `contract_type` | LTC / Spot | |
| `status` | Status | |
| `sto_number` | STO No. | Links to shipment |
| `sto_quantity` | STO Quantity | |
| `logistics_classification` | Logistics Area Classification | |
| `po_classification` | PO Classification | |

##### Shipments Table
SAP data maps to `shipments` table (SEA transport only):

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `shipment_id` | STO No. | Primary identifier |
| `contract_id` | Links to contract | Foreign key |
| `vessel_name` | Vessel Name | From ZVESSEL2 |
| `voyage_no` | Voyage No. | |
| `vessel_code` | Vessel Code | |
| `vessel_owner` | Vessel Owner/Company | |
| `port_of_loading` | Vessel Loading Port 1 | Primary loading port |
| `port_of_discharge` | Vessel Discharge Port | |
| `eta_arrival` | ETA Vessel Arrival at Loading Port 1 | |
| `ata_arrival` | ATA Vessel Arrival at Loading Port 1 | |
| `quantity_shipped` | Quantity at Loading Port 1 (BAST) | |
| `quantity_delivered` | Actual Quantity at Final Location | |
| `status` | Derived from milestones | |

**Vessel Loading Ports** (Multiple ports supported):
- `vessel_loading_ports` table stores additional loading ports (Port 2, Port 3)
- Includes ETA/ATA for arrival, berthed, loading start/complete, sailed
- Loading rates per port

##### Quality Surveys Table
SAP data maps to `quality_surveys` table (Multiple locations per shipment):

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `shipment_id` | Links to shipment | Foreign key |
| `location` | Location Name | Loading Port 1/2/3 or Discharge Port |
| `surveyor` | Vendor Name (Surveyor) | |
| `ffa` | FFA values | Free Fatty Acid |
| `moisture` | M&I values | Moisture & Impurity |
| `impurity` | M&I values | |
| `iv` | IV values | Iodine Value |
| `dobi` | DOBI | |
| `color_red` | Color-Red | |
| `d_and_s` | D&S | Dirt & Sediment |
| `stone` | Stone | |

**Multiple Locations**: Quality surveys can be created for:
- Loading Port 1
- Loading Port 2
- Loading Port 3
- Discharge Port

##### Trucking Operations Table
SAP data maps to `trucking_operations` table:

**LAND Transport** (Primary trucking operation):
- Created when transport_mode = "LAND"
- Data converted from shipment fields

**Additional Trucking** (Supporting operations):
- Created for multi-location trucking sequences

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Links to contract | Foreign key |
| `shipment_id` | Links to shipment | Null for LAND transport |
| `sequence` | Sequence Number | 1, 2, 3 for multiple locations |
| `cargo_readiness_date` | Cargo Readiness at Starting Location | |
| `truck_loading_date` | Truck Loading at Starting Location | |
| `truck_unloading_date` | Truck Unloading at Starting Location | |
| `trucking_owner` | Trucking Owner at Starting Location | |
| `trucking_oa_budget` | Trucking OA Budget at Starting Location | |
| `trucking_oa_actual` | Trucking OA Actual at Starting Location | |
| `quantity_sent` | Quantity Sent via Trucking (Surat Jalan) | |
| `quantity_delivered` | Quantity Delivered via Trucking | |
| `gain_loss` | Selisih Qty Receive vs Qty Deliver | |
| `start_date` | Trucking Starting Date at Starting Location | |
| `completion_date` | Trucking Completion Date at Starting Location | |

##### Payments Table
SAP data maps to `payments` table:

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Links to contract | Foreign key |
| `invoice_date` | DP Date | Down Payment Date |
| `payment_due_date` | Due Date Payment | |
| `payment_date` | Payoff Date | Actual payment date |
| `payment_status` | Derived | Based on dates |
| `deviation_days` | Payment Date Deviation (days) | Calculated |

### Transport Mode Routing

The system routes data based on the `Sea / Land` field:

- **SEA Transport** (`transport_mode = 'SEA'`):
  - Creates/updates `shipments` record
  - Creates `quality_surveys` for multiple locations
  - Creates `vessel_loading_ports` for multi-port loading
  - Optional trucking operations for port-to-port transport

- **LAND Transport** (`transport_mode = 'LAND'`):
  - Creates `trucking_operations` record (no shipment)
  - Converts shipment-like data to trucking format
  - Links directly to contract

### Duplicate Handling

The system prevents duplicate entries using a **tri-key combination**:
- `contract_number` + `po_number` + `sto_number`

If a record with the same tri-key exists:
- Existing `sap_processed_data` record is **updated** with latest data
- Domain tables (`contracts`, `shipments`, etc.) are **upserted** (UPDATE if exists, INSERT if not)
- Preserves data history in raw data table

### API Endpoints

- `POST /api/sap-master-v2/import-upload` - Upload and import Excel file (ADMIN only)
- `GET /api/sap-master-v2/imports` - Get import history (ADMIN, MANAGEMENT)
- `GET /api/sap-master-v2/imports/:importId` - Get import details and errors
- `GET /api/sap-master-v2/pending-entries` - Get pending manual entries

### Error Handling

- **Row-level errors**: Individual rows can fail without stopping entire import
- **Error tracking**: Failed rows stored in `sap_raw_data` with error messages
- **Import summary**: Returns count of processed vs failed records
- **Error log**: Limited to first 100 errors per import for performance

## Development

### Frontend Development
```bash
cd frontend
npm run dev
```

### Backend Development
```bash
cd backend
npm run dev
```

### Database Migrations
```bash
cd backend
npm run db:migrate
```

## Run with Docker

To run the full stack (PostgreSQL, backend, frontend) in containers:

```bash
docker-compose up -d --build
```

Then open http://localhost:3001. Optional env vars and details: **[docs/DOCKER.md](docs/DOCKER.md)**.

---

## Production deployment

For a **full step-by-step deployment guide** (database, backend, frontend, Nginx, PM2, SSL, firewall, troubleshooting), see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

Below is a minimal outline matching the AliCloud setup (frontend 172.28.92.56 / 8.215.6.189, backend 172.28.92.57):

- **Frontend server**
  - Private IP: `172.28.92.56`
  - Public IP: `8.215.6.189`
- **Backend server**
  - Private IP: `172.28.92.57` (no public IP – only reachable inside the VPC)
- **Database**
  - PostgreSQL instance reachable from the backend (for example: AliCloud RDS)

### 1. Backend deployment (172.28.92.57)

- **Environment (`backend/.env`):**

```env
PORT=5001
NODE_ENV=production

DB_HOST=<your-db-host>
DB_PORT=5432
DB_NAME=klip_db
DB_USER=<your-db-user>
DB_PASSWORD=<your-db-password>
```

- **Install & migrate (on the backend server):**

```bash
cd backend
npm ci
npm run db:migrate   # applies all SQL migrations, including vessel_loading_ports backfill
```

- **Run backend API (choose one):**

```bash
# Simple
npm run start

# Or with PM2
pm2 start dist/index.js --name klip-backend
```

Backend listens on `http://172.28.92.57:5001` inside the VPC.

### 2. Frontend deployment (172.28.92.56 / 8.215.6.189)

Because the backend has only a **private** IP, the browser must call the API via
the frontend server, using a reverse proxy.

#### 2.1 Configure frontend env

On the frontend server create `frontend/.env.production`:

```env
NEXT_PUBLIC_API_URL=/api
```

Using `/api` keeps all requests on the same origin (`https://8.215.6.189`) and lets
Nginx proxy them to the backend private IP.

Build and start the frontend:

```bash
cd frontend
npm ci
npm run build
npm run start   # Next.js production server (default :3001)
```

Frontend will be reachable at `http://8.215.6.189:3001` (or behind your load balancer).

#### 2.2 Nginx reverse proxy on frontend server

On the frontend host, configure Nginx (or another reverse proxy) so that:

- `/` is proxied to the Next.js frontend
- `/api` is proxied to the backend private IP `172.28.92.57:5001`

Example Nginx server block (HTTP, adjust for HTTPS as needed):

```nginx
server {
    listen 80;
    server_name 8.215.6.189;

    # Frontend (Next.js) – running on localhost:3001
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API – private IP in the same VPC
    location /api/ {
        proxy_pass http://172.28.92.57:5001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After reloading Nginx:

- Browser → `http://8.215.6.189` (or `:3001` depending on your setup)
- Frontend JavaScript calls `NEXT_PUBLIC_API_URL=/api`
- Nginx forwards `/api/*` to `http://172.28.92.57:5001/api/*` over the private network


## API Documentation

API documentation is available at:
`http://localhost:5001/api-docs`

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please contact the development team or create an issue in the repository.

