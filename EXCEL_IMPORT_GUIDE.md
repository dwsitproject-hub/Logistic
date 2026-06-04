# Excel Import and Automated Scheduling Guide

## Overview

This guide explains the new Excel import functionality and automated scheduling system that has been implemented for the KLIP (KPN Logistics Intelligence Platform). The system can automatically import data from the "Logistics Overview 13.10.2025 (Logic) - from IT" spreadsheet at scheduled times.

## Features

### 1. Excel File Processing
- **File Support**: Excel (.xlsx) files
- **Automatic Parsing**: Converts Excel data to structured format
- **Data Validation**: Validates file structure and data integrity
- **Error Handling**: Comprehensive error reporting and logging

### 2. Automated Scheduling
- **Daily Imports**: Automatically imports data 3 times per day
- **Jakarta Time**: All schedules are in JKT timezone (UTC+7)
- **Schedule Times**:
  - 8:00 AM JKT (Morning Import)
  - 1:00 PM JKT (Afternoon Import)  
  - 5:00 PM JKT (Evening Import)

### 3. Manual Import Capabilities
- **On-Demand Import**: Import data manually when needed
- **File Validation**: Preview and validate Excel files before import
- **Flexible Configuration**: Customize import parameters

## API Endpoints

### Excel Import Endpoints

#### 1. Import from Excel File
```http
POST /api/excel-import/import
Authorization: Bearer <token>
Content-Type: application/json

{
  "filePath": "/path/to/excel/file.xlsx",
  "sheetName": "Sheet1", // optional
  "startRow": 0, // optional
  "endRow": 100, // optional
  "columnMappings": { // optional
    "Excel Column": "Database Field"
  }
}
```

#### 2. Import Logistics Overview (Pre-configured)
```http
POST /api/excel-import/import/logistics-overview
Authorization: Bearer <token>
```

#### 3. Get Available Sheets
```http
GET /api/excel-import/sheets?filePath=/path/to/file.xlsx
Authorization: Bearer <token>
```

#### 4. Preview Excel Data
```http
GET /api/excel-import/preview?filePath=/path/to/file.xlsx&sheetName=Sheet1&maxRows=10
Authorization: Bearer <token>
```

#### 5. Validate Excel Structure
```http
GET /api/excel-import/validate?filePath=/path/to/file.xlsx&sheetName=Sheet1
Authorization: Bearer <token>
```

### Scheduled Import Management

#### 1. Get All Scheduled Imports
```http
GET /api/excel-import/schedules
Authorization: Bearer <token>
```

#### 2. Get Specific Scheduled Import
```http
GET /api/excel-import/schedules/{id}
Authorization: Bearer <token>
```

#### 3. Update Scheduled Import
```http
PUT /api/excel-import/schedules/{id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Schedule Name",
  "isActive": true,
  "schedule": "0 8 * * *"
}
```

#### 4. Delete Scheduled Import
```http
DELETE /api/excel-import/schedules/{id}
Authorization: Bearer <token>
```

#### 5. Execute Scheduled Import Manually
```http
POST /api/excel-import/schedules/{id}/execute
Authorization: Bearer <token>
```

#### 6. Get Scheduler Status
```http
GET /api/excel-import/scheduler/status
Authorization: Bearer <token>
```

## File Structure

The system expects the Excel file to be located at:
```
docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx
```

### Expected Column Structure

The system is configured to handle the following columns (case-insensitive):
- **Contract Number**: Contract identifier
- **Trader Name**: Name of the trader
- **Shipment ID**: Shipment identifier
- **Logistics Team**: Logistics team name
- **Estimated Date**: Estimated completion date
- **Actual Date**: Actual completion date
- **Status**: Current status
- **Priority**: Priority level
- **Cost**: Associated cost
- **Payment Status**: Payment status
- **Comments**: Additional comments

## User Roles and Permissions

### Admin
- Full access to all import functionality
- Can manage scheduled imports
- Can execute manual imports
- Can view scheduler status

### Support
- Can execute manual imports
- Can view scheduled imports
- Can validate Excel files
- Can preview data

### Management
- Can view scheduled imports
- Can view scheduler status
- Cannot modify schedules

### Other Roles
- No access to import functionality

## Database Integration

The imported data is processed and stored in the following tables:
- `sap_data_imports`: Import history and metadata
- `sap_raw_data`: Raw imported data
- `sap_processed_data`: Processed and normalized data
- `user_data_inputs`: User modifications to imported data

## Error Handling

### Common Errors

1. **File Not Found**
   - Error: `File not found: {filePath}`
   - Solution: Ensure the file exists at the specified path

2. **Invalid Excel Format**
   - Error: `Sheet not found: {sheetName}`
   - Solution: Check sheet name or use default sheet

3. **Data Validation Errors**
   - Error: `Excel file must have at least a header row and one data row`
   - Solution: Ensure Excel file has proper structure

4. **Permission Errors**
   - Error: `Access denied`
   - Solution: Check user role and permissions

### Logging

All import activities are logged with the following information:
- Import timestamp
- User who initiated the import
- File path and configuration
- Number of records processed
- Success/failure status
- Error details (if any)

## Monitoring and Maintenance

### Scheduler Status

Check the scheduler status regularly:
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5001/api/excel-import/scheduler/status
```

### Import History

View recent imports:
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:5001/api/sap/imports
```

### Log Files

Monitor log files for import activities:
- `backend/logs/combined.log`: All activities
- `backend/logs/error.log`: Error details

## Configuration

### Environment Variables

No additional environment variables are required. The system uses existing database and server configurations.

### Timezone Configuration

The scheduler is configured for Jakarta timezone (Asia/Jakarta). To change the timezone, modify the scheduler service configuration.

### Schedule Configuration

Default schedules can be modified in `backend/src/services/scheduler.service.ts`:

```typescript
const defaultSchedules = [
  {
    name: 'Logistics Overview - Morning Import',
    schedule: '0 8 * * *', // 8:00 AM JKT
    isActive: true
  },
  // ... other schedules
];
```

## Troubleshooting

### Scheduler Not Running

1. Check if the server is running
2. Verify scheduler initialization in logs
3. Check database connectivity
4. Ensure proper permissions

### Import Failures

1. Check file path and permissions
2. Validate Excel file structure
3. Review error logs
4. Test with manual import first

### Performance Issues

1. Monitor database performance
2. Check file size and complexity
3. Review import frequency
4. Consider optimizing queries

## Security Considerations

1. **File Access**: Ensure proper file system permissions
2. **Authentication**: All endpoints require valid JWT tokens
3. **Authorization**: Role-based access control enforced
4. **Data Validation**: Input validation prevents malicious data
5. **Logging**: All activities are logged for audit purposes

## Future Enhancements

Potential improvements for future versions:
1. **Multiple File Support**: Import from multiple Excel files
2. **Real-time Monitoring**: WebSocket-based real-time updates
3. **Advanced Scheduling**: More flexible scheduling options
4. **Data Transformation**: Custom data transformation rules
5. **Notification System**: Email/SMS notifications for import status
6. **Backup and Recovery**: Automated backup of imported data

## Support

For technical support or questions about the Excel import functionality:
1. Check the logs for error details
2. Review this documentation
3. Contact the development team
4. Create an issue in the project repository
