# KLIP API Reference

## Base URL

```
http://localhost:5001/api
```

## Authentication

All API requests (except login and registration) require authentication using JWT tokens.

### Headers

```http
Authorization: Bearer <your-jwt-token>
Content-Type: application/json
```

### Getting a Token

**POST** `/api/auth/login`

Request:
```json
{
  "username": "admin",
  "password": "admin123"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "admin",
      "email": "admin@klip.com",
      "full_name": "System Administrator",
      "role": "ADMIN",
      "is_active": true
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Response payload
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "message": "Error description"
  }
}
```

## Endpoints

### Authentication

#### Register User

**POST** `/api/auth/register`

Request:
```json
{
  "username": "newuser",
  "email": "user@klip.com",
  "password": "securepassword",
  "full_name": "John Doe",
  "role": "TRADING"
}
```

Roles: `ADMIN`, `TRADING`, `LOGISTICS`, `FINANCE`, `MANAGEMENT`, `SUPPORT`

Response: Same as login

#### Login

**POST** `/api/auth/login`

See "Getting a Token" section above.

#### Get Profile

**GET** `/api/auth/profile`

Response:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@klip.com",
    "full_name": "System Administrator",
    "role": "ADMIN",
    "is_active": true,
    "created_at": "2025-10-09T10:00:00.000Z"
  }
}
```

#### Update Profile

**PUT** `/api/auth/profile`

Request:
```json
{
  "full_name": "Updated Name",
  "email": "newemail@klip.com"
}
```

### Contracts

#### List Contracts

**GET** `/api/contracts`

Query Parameters:
- `status` (optional): Filter by status (ACTIVE, COMPLETED, CANCELLED)
- `supplier` (optional): Filter by supplier name (partial match)
- `buyer` (optional): Filter by buyer name (partial match)
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 10): Items per page

Example:
```
GET /api/contracts?status=ACTIVE&page=1&limit=20
```

Response:
```json
{
  "success": true,
  "data": {
    "contracts": [
      {
        "id": "uuid",
        "contract_id": "CNT-2025-001",
        "buyer": "KPN Corp",
        "supplier": "ABC Supplier Ltd",
        "product": "Palm Oil",
        "quantity_ordered": 1000.00,
        "unit": "MT",
        "incoterm": "CIF",
        "loading_site": "Port of Jakarta",
        "unloading_site": "Port of Singapore",
        "contract_date": "2025-01-15",
        "delivery_start_date": "2025-02-01",
        "delivery_end_date": "2025-02-28",
        "contract_value": 800000.00,
        "currency": "USD",
        "status": "ACTIVE",
        "sap_contract_id": "SAP-12345",
        "created_at": "2025-01-15T10:00:00.000Z",
        "updated_at": "2025-01-15T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 45,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    }
  }
}
```

#### Get Contract Details

**GET** `/api/contracts/:id`

Response:
```json
{
  "success": true,
  "data": {
    "contract": {
      "id": "uuid",
      "contract_id": "CNT-2025-001",
      // ... all contract fields
    },
    "shipments": [
      {
        "id": "uuid",
        "shipment_id": "SHP-2025-001",
        "vessel_name": "MV Ocean Star",
        "status": "IN_TRANSIT",
        // ... shipment fields
      }
    ],
    "payments": [
      {
        "id": "uuid",
        "invoice_number": "INV-001",
        "payment_status": "PAID",
        // ... payment fields
      }
    ]
  }
}
```

#### Create Contract

**POST** `/api/contracts`

**Authorization**: ADMIN, TRADING only

Request:
```json
{
  "contract_id": "CNT-2025-002",
  "buyer": "KPN Corp",
  "supplier": "XYZ Supplier Inc",
  "product": "Coconut Oil",
  "quantity_ordered": 500.00,
  "unit": "MT",
  "incoterm": "FOB",
  "loading_site": "Port of Manila",
  "unloading_site": "Port of Tokyo",
  "contract_date": "2025-02-01",
  "delivery_start_date": "2025-03-01",
  "delivery_end_date": "2025-03-31",
  "contract_value": 450000.00,
  "currency": "USD",
  "sap_contract_id": "SAP-67890"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "contract_id": "CNT-2025-002",
    // ... all contract fields with generated UUID and timestamps
  }
}
```

#### Update Contract

**PUT** `/api/contracts/:id`

**Authorization**: ADMIN, TRADING only

Request:
```json
{
  "status": "COMPLETED",
  "contract_value": 460000.00
}
```

### Shipments

#### List Shipments

**GET** `/api/shipments`

Query Parameters:
- `contract_id`: Filter by contract UUID
- `status`: Filter by status
- `page`: Page number
- `limit`: Items per page

#### Create Shipment

**POST** `/api/shipments`

Request:
```json
{
  "shipment_id": "SHP-2025-001",
  "contract_id": "contract-uuid",
  "vessel_name": "MV Pacific Carrier",
  "shipment_date": "2025-02-15",
  "port_of_loading": "Jakarta",
  "port_of_discharge": "Singapore",
  "quantity_shipped": 500.00,
  "inbound_weight": 500.00,
  "sla_days": 7,
  "sap_delivery_id": "SAP-DEL-001"
}
```

### Finance/Payments
### Suppliers

#### List Suppliers

GET `/api/suppliers`

Query Parameters:
- `page`: Page number
- `limit`: Items per page (max 200)
- `search`: Filters by `plant_code`, `mills`, or `parent_company`

Response:
```json
{
  "success": true,
  "data": { "items": [], "total": 0, "page": 1, "limit": 50 }
}
```

#### Create Supplier

POST `/api/suppliers`

Body: fields per schema (e.g., `plant_code`, `mills`, `province`, etc.)

#### Update Supplier

PUT `/api/suppliers/:id`

#### Delete Supplier

DELETE `/api/suppliers/:id`

#### Import Suppliers (Excel/CSV)

POST `/api/suppliers/import` (multipart/form-data)
- Field: `file` (.xlsx/.xls/.csv)
- Expected header order as template `Suppliers_Import_Template.csv` from UI


#### List Payments

**GET** `/api/finance/payments`

Query Parameters:
- `contract_id`: Filter by contract
- `payment_status`: Filter by status (PENDING, PARTIAL, PAID, OVERDUE)
- `page`: Page number
- `limit`: Items per page

#### Create Payment

**POST** `/api/finance/payments`

**Authorization**: FINANCE, ADMIN only

Request:
```json
{
  "contract_id": "contract-uuid",
  "invoice_number": "INV-2025-001",
  "invoice_date": "2025-02-20",
  "payment_amount": 100000.00,
  "currency": "USD",
  "payment_due_date": "2025-03-20",
  "payment_status": "PENDING",
  "sap_invoice_id": "SAP-INV-001"
}
```

### Documents

#### Upload Document

**POST** `/api/documents/upload`

**Content-Type**: `multipart/form-data`

Form Data:
- `file`: The document file
- `document_type`: BOL, INVOICE, SURVEY, COA, PAYMENT_PROOF, OTHER
- `contract_id` (optional): Related contract UUID
- `shipment_id` (optional): Related shipment UUID
- `payment_id` (optional): Related payment UUID
- `description` (optional): Document description

Response:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "document_type": "BOL",
    "file_name": "bill_of_lading.pdf",
    "file_path": "uploads/documents/uuid.pdf",
    "file_size": 245678,
    "mime_type": "application/pdf",
    "uploaded_by": "user-uuid",
    "upload_date": "2025-02-20T14:30:00.000Z"
  }
}
```

#### Download Document

**GET** `/api/documents/:id/download`

Returns the file with appropriate headers for download.

### Dashboard

#### Get Dashboard Statistics

**GET** `/api/dashboard/stats`

Response:
```json
{
  "success": true,
  "data": {
    "totalContracts": 45,
    "activeShipments": 12,
    "pendingPayments": 8,
    "totalRevenue": 35400000.00
  }
}
```

#### Get KPIs

**GET** `/api/dashboard/kpis`

Response:
```json
{
  "success": true,
  "data": {
    "slaPerformance": 94.5,
    "gainLossTrend": [
      { "month": "Jan", "percentage": 0.8 },
      { "month": "Feb", "percentage": 1.2 }
    ],
    "paymentRatio": 87.3,
    "topRiskContracts": [
      {
        "contract_id": "CNT-2025-001",
        "risk_score": 8.5,
        "reason": "Payment overdue by 15 days"
      }
    ]
  }
}
```

### Users (Admin Only)

#### List Users

**GET** `/api/users`

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "username": "trading",
      "email": "trading@klip.com",
      "full_name": "Trading User",
      "role": "TRADING",
      "is_active": true,
      "created_at": "2025-01-10T08:00:00.000Z"
    }
  ]
}
```

#### Create User

**POST** `/api/users`

Request:
```json
{
  "username": "newuser",
  "email": "newuser@klip.com",
  "password": "securepassword",
  "full_name": "New User",
  "role": "LOGISTICS"
}
```

### Audit Logs (Admin/Support Only)

#### Get Audit Logs

**GET** `/api/audit`

Query Parameters:
- `user_id`: Filter by user
- `action`: Filter by action type
- `entity_type`: Filter by entity type
- `start_date`: Filter from date
- `end_date`: Filter to date
- `page`: Page number
- `limit`: Items per page

Response:
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "user_id": "user-uuid",
        "action": "UPDATE",
        "entity_type": "CONTRACT",
        "entity_id": "contract-uuid",
        "before_data": { "status": "ACTIVE" },
        "after_data": { "status": "COMPLETED" },
        "ip_address": "192.168.1.1",
        "user_agent": "Mozilla/5.0...",
        "timestamp": "2025-02-20T15:45:00.000Z"
      }
    ],
    "pagination": {
      "total": 1250,
      "page": 1,
      "limit": 50,
      "totalPages": 25
    }
  }
}
```

## Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Missing or invalid token
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

## Rate Limiting

Currently no rate limiting. Future implementation will use:
- **Limit**: 1000 requests per hour per user
- **Response Header**: `X-RateLimit-Remaining`

## Pagination

Endpoints that return lists support pagination:

Request:
```
GET /api/contracts?page=2&limit=20
```

Response includes pagination metadata:
```json
{
  "pagination": {
    "total": 100,
    "page": 2,
    "limit": 20,
    "totalPages": 5
  }
}
```

## Filtering & Searching

### Query Syntax

```
GET /api/contracts?supplier=ABC&status=ACTIVE
```

Supports:
- Exact match: `status=ACTIVE`
- Partial match (case-insensitive): `supplier=ABC`
- Date range: `start_date=2025-01-01&end_date=2025-12-31`

## Data Validation

All POST and PUT requests are validated:

- **Required fields**: Must be present
- **Type validation**: Correct data types
- **Format validation**: Dates, emails, etc.
- **Enum validation**: Status values, roles, etc.

Validation errors return:
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

## Interactive API Documentation

Full interactive documentation available at:

**http://localhost:5001/api-docs**

Features:
- Try API endpoints directly
- View request/response schemas
- See authentication requirements
- Test with your JWT token

## Webhooks (Future Feature)

Future versions will support webhooks for real-time notifications:

```json
{
  "event": "shipment.arrived",
  "data": {
    "shipment_id": "SHP-2025-001",
    "status": "ARRIVED",
    "timestamp": "2025-02-20T10:30:00.000Z"
  }
}
```

## API Versioning

Currently: **v1** (implicit)

Future versions will use URL versioning:
```
/api/v2/contracts
```

## Best Practices

1. **Always include Authorization header** (except login/register)
2. **Use pagination** for large datasets
3. **Handle errors gracefully** on the client side
4. **Cache responses** when appropriate
5. **Use HTTPS** in production
6. **Validate data** before sending requests

## Error Codes Reference

| Code | Description                  | Action                        |
|------|------------------------------|-------------------------------|
| 400  | Bad Request                  | Check request data            |
| 401  | Unauthorized                 | Login or refresh token        |
| 403  | Forbidden                    | Check user permissions        |
| 404  | Not Found                    | Verify resource ID            |
| 422  | Validation Error             | Fix validation errors         |
| 500  | Internal Server Error        | Contact support               |

## Examples Using cURL

### Login

```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### Get Contracts

```bash
curl -X GET http://localhost:5001/api/contracts \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Create Contract

```bash
curl -X POST http://localhost:5001/api/contracts \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "contract_id": "CNT-2025-003",
    "buyer": "KPN Corp",
    "supplier": "Test Supplier",
    "product": "Palm Oil",
    "quantity_ordered": 1000,
    "unit": "MT",
    "contract_value": 800000,
    "currency": "USD"
  }'
```

## Examples Using JavaScript/Axios

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5001/api',
});

// Login
const login = async () => {
  const response = await api.post('/auth/login', {
    username: 'admin',
    password: 'admin123',
  });
  const token = response.data.data.token;
  // Store token
  localStorage.setItem('token', token);
  return token;
};

// Get contracts
const getContracts = async (token) => {
  const response = await api.get('/contracts', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data.data.contracts;
};

// Create contract
const createContract = async (token, contractData) => {
  const response = await api.post('/contracts', contractData, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data.data;
};
```

## Support

For API-related questions:
- Check the interactive documentation at `/api-docs`
- Review the codebase in `backend/src/routes/` and `backend/src/controllers/`
- Contact the development team

## Changelog

### Version 1.0.0 (Current)
- Initial API release
- Authentication endpoints
- Contract management
- Basic CRUD operations
- Role-based access control

### Planned Features
- Advanced search with filters
- Bulk operations
- Webhook subscriptions
- GraphQL endpoint (optional)
- File upload with progress tracking

