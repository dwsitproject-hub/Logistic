# SAP Data Integration Guide

## Overview

This guide explains how to integrate SAP data with the KLIP (KPN Logistics Intelligence Platform) system. The integration allows for daily import of SAP data, automatic categorization by user roles, and manual data input for fields not provided by SAP.

## 🏗️ System Architecture

### Database Schema

The SAP integration uses the following main tables:

1. **sap_data_imports** - Tracks import sessions
2. **sap_raw_data** - Stores raw imported data
3. **sap_processed_data** - Normalized processed data
4. **sap_field_mappings** - Maps SAP fields to user roles
5. **user_data_inputs** - Manual user inputs for missing data
6. **data_validation_rules** - Validation rules for data quality

### User Role Mapping

Based on the spreadsheet color coding:

- **TRADING** (Orange columns) - Contract management, trader information
- **LOGISTICS** (Green columns) - Shipment tracking, logistics operations
- **FINANCE** (Blue columns) - Cost management, payment processing
- **MANAGEMENT** (Purple columns) - Dashboard views, analytics
- **SUPPORT** (Default) - Data validation, audit logs

## 📊 Data Flow

```
SAP System → CSV/Excel Export → KLIP Import → Data Processing → User Interface
     ↓              ↓                ↓              ↓              ↓
Raw Data → File Upload → Validation → Normalization → Role-based Views
```

## 🔧 Implementation Steps

### 1. Database Setup

Run the migration to create SAP tables:

```bash
cd backend
npm run db:migrate
```

### 2. Field Mapping Configuration

Create default field mappings:

```typescript
import { SapImportService } from './services/sapImport.service';

// Create default field mappings
await SapImportService.createDefaultFieldMappings();
```

### 3. API Endpoints

The following endpoints are available:

#### Import Management
- `POST /api/sap/import` - Import SAP data
- `GET /api/sap/imports` - Get import history
- `GET /api/sap/imports/:id` - Get import details

#### Data Management
- `GET /api/sap/processed-data` - Get processed data
- `PUT /api/sap/processed-data/:id` - Update processed data
- `POST /api/sap/user-inputs` - Create user input

#### Field Mapping
- `GET /api/sap/field-mappings` - Get field mappings
- `POST /api/sap/field-mappings` - Create field mapping
- `PUT /api/sap/field-mappings/:id` - Update field mapping

### 4. Frontend Components

#### SapDataImport Component
- File upload interface
- Progress tracking
- Import result display
- Error handling

#### SapDataViewer Component
- Data filtering and search
- Role-based data display
- Export functionality
- Import history view

## 📋 Data Import Process

### 1. File Preparation

Ensure your SAP export file contains:
- Headers in the first row
- Consistent field names
- Proper date formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY)
- Required fields: Contract Number, Trader Name, Shipment ID, Logistics Team

### 2. Import Process

1. **File Upload**: User selects CSV/Excel file
2. **Validation**: System validates file format and required fields
3. **Processing**: Data is parsed and normalized
4. **Role Assignment**: Data is categorized by user roles
5. **Storage**: Data is stored in appropriate tables
6. **Notification**: User receives import results

### 3. Data Processing

The system automatically:
- Maps SAP fields to internal structure
- Determines user roles based on field content
- Validates data against business rules
- Creates audit trail for all changes

## 🎯 User Role Permissions

### ADMIN
- Full access to all SAP data
- Can manage field mappings
- Can delete imports
- Can view all user inputs

### TRADING
- View/edit trading-related data
- Can input missing trading information
- Can update contract details

### LOGISTICS
- View/edit logistics-related data
- Can input missing logistics information
- Can update shipment status

### FINANCE
- View/edit finance-related data
- Can input missing financial information
- Can update payment status

### MANAGEMENT
- View dashboard and analytics
- Can export data
- Can view import history

### SUPPORT
- Can validate data
- Can view audit logs
- Can assist with data quality

## 🔍 Data Validation

### Automatic Validation
- Required field validation
- Date format validation
- Data type validation
- Business rule validation

### Manual Validation
- User can flag data for review
- Support team can validate flagged data
- Audit trail for all validation actions

## 📈 Analytics and Reporting

### Dashboard Metrics
- Import success rates
- Data quality scores
- Processing times
- Error rates by field

### Reports
- Daily import summaries
- Data quality reports
- User activity reports
- System performance metrics

## 🚀 Daily Workflow

### Morning Routine
1. Export data from SAP system
2. Import data into KLIP platform
3. Review import results and errors
4. Validate critical data points

### Throughout the Day
1. Users input missing data
2. Support team validates flagged items
3. Management reviews dashboards
4. System processes updates

### End of Day
1. Generate daily reports
2. Archive completed imports
3. Update system metrics
4. Plan next day's imports

## 🔧 Configuration

### Environment Variables

```env
# SAP Integration Settings
SAP_IMPORT_BATCH_SIZE=1000
SAP_VALIDATION_ENABLED=true
SAP_AUTO_PROCESSING=true
SAP_RETENTION_DAYS=90
```

### Field Mapping Configuration

```typescript
const fieldMappings = [
  {
    sap_field_name: 'Contract Number',
    display_name: 'Contract Number',
    field_type: 'text',
    user_role: 'TRADING',
    is_required: true,
    color_code: '#FFA500'
  },
  // ... more mappings
];
```

## 🛠️ Troubleshooting

### Common Issues

1. **Import Failures**
   - Check file format and encoding
   - Verify required fields are present
   - Check date format consistency

2. **Data Processing Errors**
   - Review validation rules
   - Check field mappings
   - Verify user permissions

3. **Performance Issues**
   - Monitor database performance
   - Check import batch sizes
   - Review indexing strategy

### Error Handling

The system provides detailed error messages for:
- File format issues
- Data validation failures
- Permission errors
- System errors

## 📚 API Documentation

### Import Data

```typescript
POST /api/sap/import
Content-Type: application/json

{
  "data": [
    {
      "Contract Number": "CNT-001",
      "Trader Name": "John Doe",
      "Shipment ID": "SH-001",
      "Logistics Team": "Team A",
      "Estimated Date": "2025-10-15",
      "Status": "pending"
    }
  ],
  "importDate": "2025-10-14"
}
```

### Get Processed Data

```typescript
GET /api/sap/processed-data?userRole=TRADING&status=completed&page=1&limit=10
```

### Create User Input

```typescript
POST /api/sap/user-inputs
Content-Type: application/json

{
  "processedDataId": "uuid",
  "fieldName": "actual_date",
  "fieldValue": "2025-10-15",
  "inputType": "manual",
  "comments": "Updated based on field report"
}
```

## 🔐 Security Considerations

- All API endpoints require authentication
- Role-based access control for data
- Audit logging for all data changes
- Data encryption in transit and at rest
- Regular security updates and patches

## 📞 Support

For technical support or questions about SAP integration:

1. Check the troubleshooting section
2. Review system logs
3. Contact the development team
4. Submit a support ticket

## 🚀 Future Enhancements

Planned improvements include:
- Real-time SAP integration
- Advanced analytics and AI insights
- Mobile app support
- Enhanced reporting capabilities
- Automated data quality checks
