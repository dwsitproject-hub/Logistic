# KLIP Database Documentation

## Database Schema Overview

The KLIP database is built on PostgreSQL and consists of multiple interconnected tables to manage logistics operations comprehensively.

## Entity Relationship Diagram (Text Format)

```
users
  |
  ├──< contracts (created_by)
  |     |
  |     ├──< shipments
  |     |     |
  |     |     └──< quality_surveys
  |     |
  |     └──< payments
  |
  ├──< documents (uploaded_by)
  |
  ├──< remarks (created_by)
  |
  └──< audit_logs (user_id)
```

## Tables

### 1. users
Stores system user information and authentication data.

| Column        | Type         | Constraints                    | Description                     |
|---------------|--------------|--------------------------------|---------------------------------|
| id            | UUID         | PRIMARY KEY, DEFAULT uuid      | Unique user identifier          |
| username      | VARCHAR(100) | UNIQUE, NOT NULL               | Login username                  |
| email         | VARCHAR(255) | UNIQUE, NOT NULL               | User email address              |
| password_hash | VARCHAR(255) | NOT NULL                       | Bcrypt hashed password          |
| full_name     | VARCHAR(255) | NOT NULL                       | User's full name                |
| role          | VARCHAR(50)  | NOT NULL, CHECK constraint     | User role (ADMIN, TRADING, etc.)|
| is_active     | BOOLEAN      | DEFAULT true                   | Account status                  |
| created_at    | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP      | Account creation date           |
| updated_at    | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP      | Last update timestamp           |

**Allowed Roles**: ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT

### 2. contracts
Main contract information including buyer, supplier, and product details.

| Column                | Type          | Constraints                    | Description                     |
|-----------------------|---------------|--------------------------------|---------------------------------|
| id                    | UUID          | PRIMARY KEY                    | Unique contract identifier      |
| contract_id           | VARCHAR(100)  | UNIQUE, NOT NULL               | Business contract number        |
| buyer                 | VARCHAR(255)  | NOT NULL                       | Buyer company name              |
| supplier              | VARCHAR(255)  | NOT NULL                       | Supplier company name           |
| product               | VARCHAR(255)  | NOT NULL                       | Product description             |
| quantity_ordered      | DECIMAL(15,2) | NOT NULL                       | Ordered quantity                |
| unit                  | VARCHAR(50)   | NOT NULL                       | Unit of measurement (MT, KG)    |
| incoterm              | VARCHAR(50)   |                                | International trade terms       |
| loading_site          | VARCHAR(255)  |                                | Loading location                |
| unloading_site        | VARCHAR(255)  |                                | Unloading location              |
| contract_date         | DATE          |                                | Contract signing date           |
| delivery_start_date   | DATE          |                                | Delivery period start           |
| delivery_end_date     | DATE          |                                | Delivery period end             |
| contract_value        | DECIMAL(15,2) |                                | Total contract value            |
| currency              | VARCHAR(10)   | DEFAULT 'USD'                  | Currency code                   |
| status                | VARCHAR(50)   | CHECK constraint               | Contract status                 |
| sap_contract_id       | VARCHAR(100)  |                                | SAP system reference            |
| created_by            | UUID          | FOREIGN KEY → users(id)        | User who created the record     |
| created_at            | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP      | Creation timestamp              |
| updated_at            | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP      | Last update timestamp           |

**Status Values**: ACTIVE, COMPLETED, CANCELLED

### 3. shipments
Shipment tracking from loading to delivery.

| Column                 | Type          | Constraints                      | Description                     |
|------------------------|---------------|----------------------------------|---------------------------------|
| id                     | UUID          | PRIMARY KEY                      | Unique shipment identifier      |
| shipment_id            | VARCHAR(100)  | UNIQUE, NOT NULL                 | Business shipment number        |
| contract_id            | UUID          | FOREIGN KEY → contracts(id)      | Related contract                |
| vessel_name            | VARCHAR(255)  |                                  | Vessel/truck name               |
| shipment_date          | DATE          |                                  | Shipment start date             |
| arrival_date           | DATE          |                                  | Actual arrival date             |
| port_of_loading        | VARCHAR(255)  |                                  | Loading port/location           |
| port_of_discharge      | VARCHAR(255)  |                                  | Discharge port/location         |
| quantity_shipped       | DECIMAL(15,2) |                                  | Quantity at loading             |
| quantity_delivered     | DECIMAL(15,2) |                                  | Quantity at delivery            |
| inbound_weight         | DECIMAL(15,2) |                                  | Weight at loading               |
| outbound_weight        | DECIMAL(15,2) |                                  | Weight at delivery              |
| gain_loss_percentage   | DECIMAL(5,2)  |                                  | Calculated gain/loss %          |
| gain_loss_amount       | DECIMAL(15,2) |                                  | Absolute gain/loss amount       |
| status                 | VARCHAR(50)   | CHECK constraint                 | Shipment status                 |
| sla_days               | INT           |                                  | Target SLA in days              |
| is_delayed             | BOOLEAN       | DEFAULT false                    | Delay indicator                 |
| sap_delivery_id        | VARCHAR(100)  |                                  | SAP delivery reference          |
| created_at             | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP        | Creation timestamp              |
| updated_at             | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP        | Last update timestamp           |

**Status Values**: PLANNED, IN_TRANSIT, ARRIVED, UNLOADING, COMPLETED, CANCELLED

**Gain/Loss Calculation**: 
```sql
gain_loss_percentage = ((outbound_weight - inbound_weight) / inbound_weight) * 100
```

### 4. quality_surveys
Quality parameters and survey results for each shipment.

| Column      | Type          | Constraints                   | Description                     |
|-------------|---------------|-------------------------------|---------------------------------|
| id          | UUID          | PRIMARY KEY                   | Unique survey identifier        |
| shipment_id | UUID          | FOREIGN KEY → shipments(id)   | Related shipment                |
| coa_number  | VARCHAR(100)  |                               | Certificate of Analysis number  |
| survey_date | DATE          |                               | Survey conducted date           |
| surveyor    | VARCHAR(255)  |                               | Surveyor company name           |
| density     | DECIMAL(10,4) |                               | Density measurement             |
| ffa         | DECIMAL(10,4) |                               | Free Fatty Acid %               |
| moisture    | DECIMAL(10,4) |                               | Moisture content %              |
| impurity    | DECIMAL(10,4) |                               | Impurity level %                |
| iv          | DECIMAL(10,4) |                               | Iodine Value                    |
| remarks     | TEXT          |                               | Additional notes                |
| status      | VARCHAR(50)   | CHECK constraint              | Approval status                 |
| created_at  | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP     | Creation timestamp              |
| updated_at  | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP     | Last update timestamp           |

**Status Values**: PENDING, APPROVED, REJECTED

### 5. payments
Payment and invoice tracking per contract.

| Column              | Type          | Constraints                   | Description                     |
|---------------------|---------------|-------------------------------|---------------------------------|
| id                  | UUID          | PRIMARY KEY                   | Unique payment identifier       |
| contract_id         | UUID          | FOREIGN KEY → contracts(id)   | Related contract                |
| invoice_number      | VARCHAR(100)  |                               | Invoice reference number        |
| invoice_date        | DATE          |                               | Invoice issue date              |
| payment_amount      | DECIMAL(15,2) | NOT NULL                      | Payment amount                  |
| currency            | VARCHAR(10)   | DEFAULT 'USD'                 | Currency code                   |
| payment_due_date    | DATE          |                               | Payment deadline                |
| payment_date        | DATE          |                               | Actual payment date             |
| payment_status      | VARCHAR(50)   | CHECK constraint              | Payment status                  |
| payment_method      | VARCHAR(100)  |                               | Payment method used             |
| bank_reference      | VARCHAR(255)  |                               | Bank transaction reference      |
| sap_invoice_id      | VARCHAR(100)  |                               | SAP invoice reference           |
| created_at          | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP     | Creation timestamp              |
| updated_at          | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP     | Last update timestamp           |

**Status Values**: PENDING, PARTIAL, PAID, OVERDUE

### 6. documents
Document repository linked to contracts, shipments, or payments.

| Column       | Type         | Constraints                   | Description                     |
|--------------|--------------|-------------------------------|---------------------------------|
| id           | UUID         | PRIMARY KEY                   | Unique document identifier      |
| document_type| VARCHAR(50)  | NOT NULL, CHECK constraint    | Document type                   |
| file_name    | VARCHAR(255) | NOT NULL                      | Original file name              |
| file_path    | VARCHAR(500) | NOT NULL                      | Storage path                    |
| file_size    | BIGINT       |                               | File size in bytes              |
| mime_type    | VARCHAR(100) |                               | File MIME type                  |
| contract_id  | UUID         | FOREIGN KEY → contracts(id)   | Related contract (optional)     |
| shipment_id  | UUID         | FOREIGN KEY → shipments(id)   | Related shipment (optional)     |
| payment_id   | UUID         | FOREIGN KEY → payments(id)    | Related payment (optional)      |
| uploaded_by  | UUID         | FOREIGN KEY → users(id)       | User who uploaded               |
| upload_date  | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP     | Upload timestamp                |
| description  | TEXT         |                               | Document description            |

**Document Types**: BOL, INVOICE, SURVEY, COA, PAYMENT_PROOF, OTHER

### 7. remarks
Comments and notes for various entities.

| Column              | Type        | Constraints                      | Description                     |
|---------------------|-------------|----------------------------------|---------------------------------|
| id                  | UUID        | PRIMARY KEY                      | Unique remark identifier        |
| text                | TEXT        | NOT NULL                         | Remark content                  |
| category            | VARCHAR(50) |                                  | Remark category                 |
| related_entity_type | VARCHAR(50) | CHECK constraint                 | Entity type                     |
| related_entity_id   | UUID        | NOT NULL                         | Related entity ID               |
| created_by          | UUID        | FOREIGN KEY → users(id)          | User who created                |
| created_at          | TIMESTAMP   | DEFAULT CURRENT_TIMESTAMP        | Creation timestamp              |
| updated_at          | TIMESTAMP   | DEFAULT CURRENT_TIMESTAMP        | Last update timestamp           |

**Entity Types**: CONTRACT, SHIPMENT, PAYMENT, QUALITY

### 8. audit_logs
Complete system activity tracking.

| Column       | Type         | Constraints                      | Description                     |
|--------------|--------------|----------------------------------|---------------------------------|
| id           | UUID         | PRIMARY KEY                      | Unique log identifier           |
| user_id      | UUID         | FOREIGN KEY → users(id)          | User who performed action       |
| action       | VARCHAR(100) | NOT NULL                         | Action performed                |
| entity_type  | VARCHAR(50)  | NOT NULL                         | Affected entity type            |
| entity_id    | UUID         |                                  | Affected entity ID              |
| before_data  | JSONB        |                                  | Data before change              |
| after_data   | JSONB        |                                  | Data after change               |
| ip_address   | VARCHAR(50)  |                                  | Request IP address              |
| user_agent   | TEXT         |                                  | Request user agent              |
| timestamp    | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP        | Action timestamp                |

### 9. ai_insights
AI-generated insights and recommendations.

| Column              | Type         | Constraints                      | Description                     |
|---------------------|--------------|----------------------------------|---------------------------------|
| id                  | UUID         | PRIMARY KEY                      | Unique insight identifier       |
| insight_type        | VARCHAR(50)  | NOT NULL, CHECK constraint       | Type of insight                 |
| severity            | VARCHAR(20)  | CHECK constraint                 | Severity level                  |
| title               | VARCHAR(255) | NOT NULL                         | Insight title                   |
| description         | TEXT         | NOT NULL                         | Detailed description            |
| recommendation      | TEXT         |                                  | Recommended action              |
| related_entity_type | VARCHAR(50)  |                                  | Related entity type             |
| related_entity_id   | UUID         |                                  | Related entity ID               |
| status              | VARCHAR(50)  | CHECK constraint                 | Insight status                  |
| created_at          | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP        | Creation timestamp              |
| acknowledged_by     | UUID         | FOREIGN KEY → users(id)          | User who acknowledged           |
| acknowledged_at     | TIMESTAMP    |                                  | Acknowledgment timestamp        |

**Insight Types**: SLA_RISK, GAIN_LOSS, QUALITY_ALERT, PAYMENT_ALERT, RECOMMENDATION

**Severity Levels**: LOW, MEDIUM, HIGH, CRITICAL

**Status Values**: NEW, ACKNOWLEDGED, RESOLVED, DISMISSED

### 10. alerts
System-generated alerts for users.

| Column              | Type          | Constraints                      | Description                     |
|---------------------|---------------|----------------------------------|---------------------------------|
| id                  | UUID          | PRIMARY KEY                      | Unique alert identifier         |
| alert_type          | VARCHAR(50)   | NOT NULL                         | Alert type                      |
| title               | VARCHAR(255)  | NOT NULL                         | Alert title                     |
| message             | TEXT          | NOT NULL                         | Alert message                   |
| severity            | VARCHAR(20)   | CHECK constraint                 | Severity level                  |
| target_role         | VARCHAR(50)[] |                                  | Target user roles (array)       |
| is_read             | BOOLEAN       | DEFAULT false                    | Read status                     |
| related_entity_type | VARCHAR(50)   |                                  | Related entity type             |
| related_entity_id   | UUID          |                                  | Related entity ID               |
| created_at          | TIMESTAMP     | DEFAULT CURRENT_TIMESTAMP        | Creation timestamp              |

**Severity Levels**: INFO, WARNING, ERROR, CRITICAL

## Indexes

Performance-optimized indexes:

```sql
CREATE INDEX idx_contracts_contract_id ON contracts(contract_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_shipments_contract_id ON shipments(contract_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_payments_contract_id ON payments(contract_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_documents_contract_id ON documents(contract_id);
CREATE INDEX idx_documents_shipment_id ON documents(shipment_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_ai_insights_status ON ai_insights(status);
CREATE INDEX idx_alerts_target_role ON alerts USING GIN(target_role);
```

## Triggers

Automatic timestamp updates:

```sql
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at 
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shipments_updated_at 
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quality_surveys_updated_at 
  BEFORE UPDATE ON quality_surveys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at 
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_remarks_updated_at 
  BEFORE UPDATE ON remarks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## Database Backup

Recommended backup strategy:

```bash
# Full backup
pg_dump -U postgres -d klip_db > backup_$(date +%Y%m%d).sql

# Restore
psql -U postgres -d klip_db < backup_YYYYMMDD.sql
```

## Performance Tuning

Recommended PostgreSQL settings for production:

```sql
-- Increase shared buffers
shared_buffers = 256MB

-- Increase work memory
work_mem = 4MB

-- Increase maintenance work memory
maintenance_work_mem = 64MB

-- Enable query planner improvements
effective_cache_size = 1GB
```

## Data Retention

Recommended retention policies:

- **audit_logs**: 12 months
- **ai_insights**: 6 months (archived after resolution)
- **alerts**: 3 months (after read)
- **documents**: Retain as per compliance requirements

## Database Migrations

All migrations are tracked in the `backend/src/database/` directory:

- `schema.sql`: Complete schema definition
- `migrate.ts`: Migration runner
- `seed.ts`: Initial data seeder

Run migrations:
```bash
cd backend
npm run db:migrate
npm run db:seed
```

## Security Considerations

1. **Password Security**: All passwords are hashed using bcrypt with 10 salt rounds
2. **UUID Primary Keys**: Prevents enumeration attacks
3. **Check Constraints**: Ensures data integrity at database level
4. **Foreign Key Constraints**: Maintains referential integrity
5. **No Sensitive Data in Logs**: Passwords and tokens never logged
6. **Regular Backups**: Automated daily backups recommended

## Monitoring Queries

Useful queries for monitoring:

```sql
-- Active contracts count
SELECT status, COUNT(*) FROM contracts GROUP BY status;

-- Overdue payments
SELECT * FROM payments 
WHERE payment_status != 'PAID' 
AND payment_due_date < CURRENT_DATE;

-- Delayed shipments
SELECT * FROM shipments 
WHERE is_delayed = true 
AND status NOT IN ('COMPLETED', 'CANCELLED');

-- User activity summary
SELECT u.username, COUNT(al.id) as actions
FROM users u
LEFT JOIN audit_logs al ON u.id = al.user_id
WHERE al.timestamp > CURRENT_DATE - INTERVAL '7 days'
GROUP BY u.username
ORDER BY actions DESC;
```

## Support

For database-related issues or questions, refer to the main README.md or contact the development team.

