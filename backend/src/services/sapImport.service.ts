import pool from '../database/connection';
import logger from '../utils/logger';
import { FinanceMaterializedViewService } from './financeMaterializedView.service';

export interface SapDataRow {
  [key: string]: any;
}

export interface SapImportResult {
  success: boolean;
  importId?: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  errors?: string[];
}

export class SapImportService {
  
  /**
   * Import SAP data from spreadsheet/CSV format
   */
  static async importSapData(
    data: SapDataRow[], 
    importDate?: string
  ): Promise<SapImportResult> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create import record
      const importResult = await client.query(
        `INSERT INTO sap_data_imports (import_date, status, total_records) 
         VALUES ($1, 'processing', $2) 
         RETURNING id`,
        [importDate || new Date().toISOString().split('T')[0], data.length]
      );
      
      const importId = importResult.rows[0].id;
      let processedRecords = 0;
      let failedRecords = 0;
      const errors: string[] = [];
      
      // Process each row with SAVEPOINT for error recovery
      for (let i = 0; i < data.length; i++) {
        const savepointName = `sp_row_${i}_${Date.now()}`;
        let savepointCreated = false;
        
        try {
          const row = data[i];
          
          // Create a savepoint before processing each row
          await client.query(`SAVEPOINT ${savepointName}`);
          savepointCreated = true;
          
          // Insert raw data and get the ID
          const rawDataResult = await client.query(
            `INSERT INTO sap_raw_data (import_id, row_number, data, status) 
             VALUES ($1, $2, $3, 'pending') RETURNING id`,
            [importId, i + 1, JSON.stringify(row)]
          );
          
          const rawDataId = rawDataResult.rows[0].id;
          
          // Process and normalize data
          const processedData = this.processSapRowSimple(row, importId, rawDataId);
          
          if (!processedData) {
            throw new Error('Failed to process row data - processSapRowSimple returned null');
          }
          
          // Insert processed data with all fields
          await client.query(
            `INSERT INTO sap_processed_data 
             (import_id, raw_data_id, contract_number, shipment_id, trader_name, 
              logistics_team, estimated_date, actual_date, status, priority, data,
              group_name, supplier_name, product, po_number, sto_number, vessel_name, incoterm, transport_mode) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            [
              importId,
              rawDataId,
              processedData.contractNumber,
              processedData.shipmentId,
              processedData.traderName,
              processedData.logisticsTeam,
              processedData.estimatedDate,
              processedData.actualDate,
              processedData.status,
              processedData.priority,
              JSON.stringify(processedData.data),
              processedData.groupName,
              processedData.supplierName,
              processedData.product,
              processedData.poNumber,
              processedData.stoNumber,
              processedData.vesselName,
              processedData.incoterm,
              processedData.transportMode
            ]
          );
          
          // Update raw data status
          await client.query(
            `UPDATE sap_raw_data SET status = 'processed' WHERE id = $1`,
            [rawDataId]
          );
          
          // Release savepoint on success
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);
          savepointCreated = false;
          
          processedRecords++;
          
        } catch (rowError) {
          // Rollback to savepoint if it was created
          if (savepointCreated) {
            try {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
              await client.query(`RELEASE SAVEPOINT ${savepointName}`);
            } catch (rollbackError) {
              logger.error(`Failed to rollback savepoint for row ${i + 1}:`, rollbackError);
            }
          }
          
          failedRecords++;
          const errorMsg = rowError instanceof Error ? rowError.message : 'Unknown error';
          const errorStack = rowError instanceof Error ? rowError.stack : '';
          errors.push(`Row ${i + 1}: ${errorMsg}`);
          
          logger.error(`Failed to process row ${i + 1}:`, {
            error: errorMsg,
            stack: errorStack,
            rowNumber: i + 1,
            rowData: data[i]
          });
        }
      }
      
      // Update import status
      await client.query(
        `UPDATE sap_data_imports 
         SET status = $1, processed_records = $2, failed_records = $3, error_log = $4 
         WHERE id = $5`,
        [
          failedRecords === 0 ? 'completed' : 'completed_with_errors',
          processedRecords,
          failedRecords,
          errors.length > 0 ? JSON.stringify(errors) : null,
          importId
        ]
      );
      
      await client.query('COMMIT');

      // Refresh finance MV + pipeline daily summaries in background (do not block import response).
      setImmediate(() => {
        FinanceMaterializedViewService.refreshContractPaymentDates().catch(() => {});
        import('./pipelineDailySummary.service')
          .then(({ PipelineDailySummaryService }) => PipelineDailySummaryService.refreshAll())
          .catch(() => {});
        import('./contractQtyMoveSnapshot.service')
          .then(({ ContractQtyMoveSnapshotService }) => ContractQtyMoveSnapshotService.refreshAll())
          .catch(() => {});
        import('./contractStoAggSnapshot.service')
          .then(({ ContractStoAggSnapshotService }) => ContractStoAggSnapshotService.refreshAll())
          .catch(() => {});
        import('./contractLatestSpdSnapshot.service')
          .then(({ ContractLatestSpdSnapshotService }) => ContractLatestSpdSnapshotService.refreshAll())
          .catch(() => {});
      });
      
      logger.info(`SAP import completed: ${importId}`, {
        importId,
        totalRecords: data.length,
        processedRecords,
        failedRecords
      });
      
      return {
        success: true,
        importId,
        totalRecords: data.length,
        processedRecords,
        failedRecords,
        errors: errors.length > 0 ? errors : undefined
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('SAP import failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Process individual SAP data row (simplified version - no async needed)
   */
  private static processSapRowSimple(row: SapDataRow, importId: string, rawDataId: string): any {
    try {
      // Extract contract number from various possible field names
      const contractNumber = row['Contract No.\r\n(no contract)\r\nini nomer kontrak auto generate '] 
        || row['Contract Number'] 
        || row['contract_number'] 
        || row['Contract No.']
        || null;

      // Extract product name
      const product = row['Product\r\n(material desc)']
        || row['Product']
        || row['product']
        || null;

      // Extract PO number
      const poNumber = row['PO No.']
        || row['PO Number']
        || row['po_number']
        || null;

      // Extract STO number
      const stoNumber = row['STO No.']
        || row['STO Number']
        || row['sto_number']
        || null;

      // Extract supplier
      const supplier = row['Supplier\r\n(vendor -> name 1))']
        || row['Supplier']
        || row['supplier']
        || null;

      // Extract vessel name
      const vesselName = row['Vessel Name']
        || row['vessel_name']
        || null;

      // Extract incoterm
      const incoterm = row['Incoterm']
        || row['incoterm']
        || null;

      // Extract transport mode
      const transportMode = row['Sea / Land']
        || row['transport_mode']
        || null;

      // Extract STO quantity
      const stoQuantity = row[' STO Quantity ']
        || row['STO Quantity']
        || row['sto_quantity']
        || null;

      // Extract contract quantity
      const contractQuantity = row['Contract Quantity\r\n(or PO Qty)']
        || row['Contract Quantity']
        || row['contract_quantity']
        || null;

      // Map SAP fields to our structure
      const processedData = {
        rawDataId,
        contractNumber,
        shipmentId: row['Shipment ID'] || row['shipment_id'] || null,
        traderName: row['Trader Name'] || row['trader_name'] || null,
        logisticsTeam: row['Logistics Team'] || row['logistics_team'] || null,
        estimatedDate: this.parseDate(row['Estimated Date'] || row['estimated_date']),
        actualDate: this.parseDate(row['Actual Date'] || row['actual_date']),
        status: row['Status'] || row['status'] || 'pending',
        priority: row['Priority'] || row['priority'] || 'medium',
        groupName: row['Group'] || null,
        supplierName: supplier,
        product: product,
        poNumber: poNumber,
        stoNumber: stoNumber,
        vesselName: vesselName,
        incoterm: incoterm,
        transportMode: transportMode,
        data: {
          // Store all original data plus processed fields
          raw: row,
          user_role: this.determineUserRole(row),
          processed_at: new Date().toISOString(),
          import_id: importId,
          // Store key contract fields for easy access
          contract: {
            contract_no: contractNumber,
            contract_quantity: contractQuantity,
            sto_quantity: stoQuantity,
            product: product,
            supplier: supplier,
            incoterm: incoterm,
            po_no: poNumber,
            group: row['Group'] || null,
            source: row['Source\r\n(3rd Party/Inhouse)'] || null,
            ltc_spot: row['LTC / Spot'] || null,
            sea_land: transportMode,
            unit_price: row['Unit Price'] || null,
            status: row['Status'] || null,
            contract_date: row['Contract Date\r\n(sama dengan PO date)'] || null,
            due_date_delivery_start: row['Due Date Delivery\r\n(Start)'] || null,
            due_date_delivery_end: row['Due Date Delivery\r\n(End)'] || null,
            po_classification: row[' PO Classification '] || null,
            logistics_area_classification: row[' Logistics Area Classification '] || null
          }
        }
      };
      
      return processedData;
      
    } catch (error) {
      logger.error('Failed to process SAP row:', error);
      return null;
    }
  }
  
  
  /**
   * Determine user role based on data content
   */
  private static determineUserRole(row: SapDataRow): string {
    // Logic to determine which team/role this data belongs to
    // Based on the spreadsheet color coding and field content
    
    if (row['Trader'] || row['trader'] || row['Trading'] || row['trading']) {
      return 'TRADING';
    }
    
    if (row['Logistics'] || row['logistics'] || row['Trucking'] || row['trucking']) {
      return 'LOGISTICS';
    }
    
    if (row['Finance'] || row['finance'] || row['Payment'] || row['payment']) {
      return 'FINANCE';
    }
    
    if (row['Management'] || row['management'] || row['Dashboard'] || row['dashboard']) {
      return 'MANAGEMENT';
    }
    
    // Default to support for data validation
    return 'SUPPORT';
  }
  
  /**
   * Parse date from various formats
   */
  private static parseDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    try {
      // Handle different date formats
      if (typeof dateValue === 'string') {
        // Try different date formats
        const formats = [
          'YYYY-MM-DD',
          'DD/MM/YYYY',
          'MM/DD/YYYY',
          'DD-MM-YYYY',
          'MM-DD-YYYY'
        ];
        
        for (const _format of formats) {
          try {
            const parsed = new Date(dateValue);
            if (!isNaN(parsed.getTime())) {
              return parsed;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (dateValue instanceof Date) {
        return dateValue;
      }
      
      return null;
    } catch (error) {
      logger.warn('Failed to parse date:', dateValue);
      return null;
    }
  }
  
  /**
   * Get field mappings for a specific user role
   */
  static async getFieldMappings(userRole: string) {
    try {
      const result = await pool.query(
        `SELECT * FROM sap_field_mappings 
         WHERE user_role = $1 
         ORDER BY sort_order, field_name`,
        [userRole]
      );
      
      return result.rows;
    } catch (error) {
      logger.error('Failed to get field mappings:', error);
      throw error;
    }
  }
  
  /**
   * Create default field mappings based on spreadsheet structure
   */
  static async createDefaultFieldMappings() {
    const defaultMappings = [
      // Trading Team Fields
      { sap_field_name: 'Contract Number', display_name: 'Contract Number', field_type: 'text', user_role: 'TRADING', is_required: true, color_code: '#FFA500', sort_order: 1 },
      { sap_field_name: 'Trader Name', display_name: 'Trader Name', field_type: 'text', user_role: 'TRADING', is_required: true, color_code: '#FFA500', sort_order: 2 },
      { sap_field_name: 'Estimated Date', display_name: 'Estimated Date', field_type: 'date', user_role: 'TRADING', is_required: false, color_code: '#FFA500', sort_order: 3 },
      { sap_field_name: 'Actual Date', display_name: 'Actual Date', field_type: 'date', user_role: 'TRADING', is_required: false, color_code: '#FFA500', sort_order: 4 },
      
      // Logistics Team Fields
      { sap_field_name: 'Shipment ID', display_name: 'Shipment ID', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 1 },
      { sap_field_name: 'Logistics Team', display_name: 'Logistics Team', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 2 },
      { sap_field_name: 'Status', display_name: 'Status', field_type: 'text', user_role: 'LOGISTICS', is_required: true, color_code: '#00FF00', sort_order: 3 },
      { sap_field_name: 'Priority', display_name: 'Priority', field_type: 'text', user_role: 'LOGISTICS', is_required: false, color_code: '#00FF00', sort_order: 4 },
      
      // Finance Team Fields
      { sap_field_name: 'Cost', display_name: 'Cost', field_type: 'number', user_role: 'FINANCE', is_required: false, color_code: '#0000FF', sort_order: 1 },
      { sap_field_name: 'Payment Status', display_name: 'Payment Status', field_type: 'text', user_role: 'FINANCE', is_required: false, color_code: '#0000FF', sort_order: 2 },
      
      // Management Fields
      { sap_field_name: 'Dashboard', display_name: 'Dashboard View', field_type: 'boolean', user_role: 'MANAGEMENT', is_required: false, color_code: '#800080', sort_order: 1 },
    ];
    
    try {
      for (const mapping of defaultMappings) {
        await pool.query(
          `INSERT INTO sap_field_mappings 
           (sap_field_name, display_name, field_type, user_role, is_required, color_code, sort_order) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           ON CONFLICT (sap_field_name, user_role) DO NOTHING`,
          [
            mapping.sap_field_name,
            mapping.display_name,
            mapping.field_type,
            mapping.user_role,
            mapping.is_required,
            mapping.color_code,
            mapping.sort_order
          ]
        );
      }
      
      logger.info('Default field mappings created successfully');
    } catch (error) {
      logger.error('Failed to create default field mappings:', error);
      throw error;
    }
  }
}
