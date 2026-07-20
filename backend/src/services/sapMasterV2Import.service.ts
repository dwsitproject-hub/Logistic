import * as XLSX from 'xlsx';
import * as fs from 'fs';
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  SAP_MASTER_V2_UAT_FIELD_MAPPING,
  applySapMasterV2RawFieldAliases,
  isSapMasterV2UatFlatHeaderRow,
  isTruckingQuantityField,
  resolveSapMasterV2QualityLocation,
} from '../utils/sapMasterV2UatFormat';
import { SapDataDistributionService } from './sapDataDistribution.service';
import { invalidateShipmentsListCache } from './shipmentList.service';
import { normalizePoNumber } from '../utils/contractPoIdentity';

export interface MasterV2Config {
  filePath: string;
  sheetName: string;
  legendRow1: number; // Row 2 (index 1)
  legendRow2: number; // Row 3 (index 2)
  headerRow: number;  // Row 5 (index 4)
  sapFieldRow1: number; // Row 7 (index 6)
  sapFieldRow2: number; // Row 8 (index 7)
  dataStartRow: number; // Row 9 (index 8)
}

export interface SapMasterV2ImportResult {
  success: boolean;
  importId?: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords?: number;
  errors?: string[];
  summary?: {
    contractsCreated: number;
    shipmentsCreated: number;
    qualitySurveysCreated: number;
    truckingOperationsCreated: number;
    paymentsCreated: number;
  };
}

export interface FieldMetadata {
  columnIndex: number;
  index: number;
  headerName: string;
  sapSource1: string;
  sapSource2: string;
  userRole: string;
  isFromSap: boolean;
  isManualEntry: boolean;
  isCalculated: boolean;
}

interface MasterV2WorkbookData {
  fieldMetadata: FieldMetadata[];
  validDataRows: any[][];
  sheetName: string;
}

export class SapMasterV2ImportService {
  
  private static DEFAULT_CONFIG: MasterV2Config = {
    filePath: '',
    sheetName: 'Logistic Report', // Updated to new template name - falls back to first sheet if not found
    legendRow1: 0,  // Row 1 in Excel (0-indexed) - actual headers
    legendRow2: 0,  // Row 1 - same as headers
    headerRow: 0,   // Row 1 - actual headers
    sapFieldRow1: 0, // Row 1 - same as headers
    sapFieldRow2: 0, // Row 1 - same as headers
    dataStartRow: 1  // Row 2 - first data row
  };
  
  /**
   * Parse workbook from disk (throws on invalid file/sheet before any DB write).
   */
  private static loadMasterV2WorkbookData(filePath: string): MasterV2WorkbookData {
    const workbook = XLSX.readFile(filePath);
    let sheetName = this.DEFAULT_CONFIG.sheetName;
    if (!workbook.SheetNames.includes(sheetName)) {
      sheetName = workbook.SheetNames.includes('MASTER v2')
        ? 'MASTER v2'
        : workbook.SheetNames[0];
    }
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as any[][];

    const config = this.resolveWorkbookConfig(jsonData);
    const fieldMetadata = this.parseFieldMetadata(jsonData, config);
    const dataRows = jsonData.slice(config.dataStartRow);
    const validDataRows = dataRows.filter(
      (row) => row && row.some((cell) => cell !== null && cell !== undefined && cell !== '')
    );

    logger.info('Excel file loaded', { totalRows: jsonData.length, sheetName, dataRows: validDataRows.length });

    return { fieldMetadata, validDataRows, sheetName };
  }

  /** Detect UAT flat header (82 cols) vs legacy multi-row MASTER v2 template. */
  private static resolveWorkbookConfig(jsonData: any[][]): MasterV2Config {
    if (isSapMasterV2UatFlatHeaderRow(jsonData[0] ?? [])) {
      return { ...this.DEFAULT_CONFIG };
    }
    // Legacy template: metadata rows 0-7, headers row 8, data from row 9
    const legacyHeaderIdx = jsonData.findIndex((row, idx) =>
      idx > 0 &&
      Array.isArray(row) &&
      row.some((cell) => String(cell ?? '').toLowerCase().includes('contract no')),
    );
    if (legacyHeaderIdx >= 0) {
      return {
        ...this.DEFAULT_CONFIG,
        legendRow1: Math.max(0, legacyHeaderIdx - 2),
        legendRow2: Math.max(0, legacyHeaderIdx - 1),
        headerRow: legacyHeaderIdx,
        sapFieldRow1: legacyHeaderIdx,
        sapFieldRow2: legacyHeaderIdx,
        dataStartRow: legacyHeaderIdx + 1,
      };
    }
    return { ...this.DEFAULT_CONFIG };
  }

  private static async markImportFailed(importId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await pool.query(
        `UPDATE sap_data_imports
         SET status = 'failed', error_log = $1
         WHERE id = $2`,
        [JSON.stringify([message]), importId]
      );
    } catch (updateErr) {
      logger.error('Failed to mark SAP import as failed', { importId, updateErr });
    }
  }

  /**
   * Queue a file import: validate + create DB record, then process rows in the background.
   * Returns quickly so nginx/proxy timeouts do not abort long imports (~5000+ rows).
   */
  static async queueMasterV2FileImport(filePath: string): Promise<{ importId: string; totalRecords: number }> {
    const { fieldMetadata, validDataRows } = this.loadMasterV2WorkbookData(filePath);

    const client = await pool.connect();
    let importId: string;
    try {
      await client.query('BEGIN');
      const importResult = await client.query(
        `INSERT INTO sap_data_imports (import_date, status, total_records)
         VALUES (CURRENT_DATE, 'processing', $1)
         RETURNING id`,
        [validDataRows.length]
      );
      importId = importResult.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    setImmediate(() => {
      void (async () => {
        try {
          await this.processMasterV2Import(importId, validDataRows, fieldMetadata);
          logger.info('SAP MASTER v2 background import completed', { importId });
        } catch (error) {
          logger.error('SAP MASTER v2 background import failed', { importId, error });
          await this.markImportFailed(importId, error);
        } finally {
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (unlinkErr) {
              logger.warn('Failed to delete temp SAP upload file', { filePath, unlinkErr });
            }
          }
        }
      })();
    });

    return { importId, totalRecords: validDataRows.length };
  }

  /**
   * Import data from SAP MASTER v2 Excel file (blocks until all rows are processed).
   */
  static async importMasterV2File(filePath: string): Promise<SapMasterV2ImportResult> {
    const { fieldMetadata, validDataRows } = this.loadMasterV2WorkbookData(filePath);

    const client = await pool.connect();
    let importId: string;
    try {
      await client.query('BEGIN');
      const importResult = await client.query(
        `INSERT INTO sap_data_imports (import_date, status, total_records)
         VALUES (CURRENT_DATE, 'processing', $1)
         RETURNING id`,
        [validDataRows.length]
      );
      importId = importResult.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return this.processMasterV2Import(importId, validDataRows, fieldMetadata);
  }

  private static async processMasterV2Import(
    importId: string,
    validDataRows: any[][],
    fieldMetadata: FieldMetadata[]
  ): Promise<SapMasterV2ImportResult> {
    const client = await pool.connect();

    try {
      logger.info('Processing SAP MASTER v2 import rows', { importId, totalRows: validDataRows.length });

      await client.query('BEGIN');

      // 6. Process each data row
      let processedRecords = 0;
      let failedRecords = 0;
      let skippedRecords = 0;
      const errors: string[] = [];
      
      const summary = {
        contractsCreated: 0,
        shipmentsCreated: 0,
        qualitySurveysCreated: 0,
        truckingOperationsCreated: 0,
        paymentsCreated: 0
      };

      const maybeRefreshImportProgress = async () => {
        const rowsDone = processedRecords + failedRecords + skippedRecords;
        if (rowsDone === 1 || rowsDone % 25 === 0) {
          if (rowsDone % 100 === 0) {
            logger.info(`Progress: ${rowsDone}/${validDataRows.length} records processed`);
          }
          await pool.query(
            `UPDATE sap_data_imports SET processed_records = $1, failed_records = $2 WHERE id = $3`,
            [processedRecords + skippedRecords, failedRecords, importId],
          );
        }
      };
      
      for (let i = 0; i < validDataRows.length; i++) {
        const savepointName = `sp_mv2_${i}`;
        // Track the rawDataId so we can mark failures with specific error messages
        let rawDataId!: string;
        try {
          const row = validDataRows[i];

          // Create a SAVEPOINT per row to avoid aborting the whole transaction
          await client.query(`SAVEPOINT ${savepointName}`);

          // Store raw data
          const rawDataResult = await client.query(
            `INSERT INTO sap_raw_data (import_id, row_number, data, status) 
             VALUES ($1, $2, $3, 'pending') RETURNING id`,
            [importId, i + 1, JSON.stringify(row)]
          );
          rawDataId = rawDataResult.rows[0].id;

          // Parse row into structured data
          const parsedData = this.parseDataRow(row, fieldMetadata);

          // Match processed SAP rows by PO + STO (contract_no may be null or change over time).
          const contractNumber = parsedData.contract?.contract_no || null;
          const poNumber = normalizePoNumber(parsedData.contract?.po_no);
          const stoNumber =
            parsedData.shipment?.sto_no || parsedData.contract?.sto_no || null;
          const stoKey = String(stoNumber ?? '').trim();

          if (!poNumber) {
            throw new Error('Row skipped: PO number is required');
          }

          const existingProcessed = await client.query(
            `SELECT id FROM sap_processed_data
             WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text)
               AND COALESCE(NULLIF(TRIM(COALESCE(sto_number::text, '')), ''), '') = COALESCE(NULLIF(TRIM($2::text), ''), '')
             LIMIT 1`,
            [poNumber, stoKey],
          );

          if (existingProcessed.rows.length > 0) {
              const existingId = existingProcessed.rows[0].id;
              logger.info(`Updating existing processed data for PO+STO (po=${poNumber}, sto=${stoKey || '(empty)'})`);

              // Update the processed record with latest parsed data and key attributes
              const supplierName = parsedData.contract?.supplier || null;
              const product = parsedData.contract?.product || null;
              const vesselName = parsedData.vessel?.vessel_name || parsedData.shipment?.vessel || null;
              const incoterm = parsedData.contract?.incoterm || null;
              const transportMode = parsedData.contract?.sea_land || parsedData.contract?.transport_mode || null;
              const shipmentId =
                parsedData.shipment?.shipment_id || parsedData.shipment?.id || stoKey || null;

              await client.query(
                `UPDATE sap_processed_data
                   SET data = $1,
                       import_id = $2,
                       raw_data_id = $3,
                       contract_number = $4,
                       shipment_id = $5,
                       po_number = $6,
                       sto_number = $7,
                       supplier_name = $8,
                       product = $9,
                       vessel_name = $10,
                       incoterm = $11,
                       transport_mode = $12
                 WHERE id = $13`,
                [
                  JSON.stringify(parsedData),
                  importId,
                  rawDataId,
                  contractNumber,
                  shipmentId,
                  poNumber,
                  stoKey || null,
                  supplierName,
                  product,
                  vesselName,
                  incoterm,
                  transportMode,
                  existingId
                ]
              );

              // Distribute to domain tables (acts as upsert in distribution service)
              const distributionResult = await this.distributeToTables(client, parsedData);

              summary.contractsCreated += distributionResult.contractCreated ? 1 : 0;
              summary.shipmentsCreated += distributionResult.shipmentCreated ? 1 : 0;
              summary.qualitySurveysCreated += distributionResult.qualitySurveysCreated;
              summary.truckingOperationsCreated += distributionResult.truckingOperationsCreated;
              summary.paymentsCreated += distributionResult.paymentCreated ? 1 : 0;

              // Mark current raw row as processed
              await client.query(
                'UPDATE sap_raw_data SET status = $1 WHERE id = $2',
                ['processed', rawDataId]
              );

              await client.query(`RELEASE SAVEPOINT ${savepointName}`);
              processedRecords++;
              await maybeRefreshImportProgress();
              continue;
          }

          // Store in sap_processed_data
          await this.storeProcessedData(client, importId, rawDataId, parsedData);

          // Distribute to main tables
          const distributionResult = await this.distributeToTables(client, parsedData);

          summary.contractsCreated += distributionResult.contractCreated ? 1 : 0;
          summary.shipmentsCreated += distributionResult.shipmentCreated ? 1 : 0;
          summary.qualitySurveysCreated += distributionResult.qualitySurveysCreated;
          summary.truckingOperationsCreated += distributionResult.truckingOperationsCreated;
          summary.paymentsCreated += distributionResult.paymentCreated ? 1 : 0;

          // Update raw data status
          await client.query(
            'UPDATE sap_raw_data SET status = $1 WHERE id = $2',
            ['processed', rawDataId]
          );

          // Release savepoint on success
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);

          processedRecords++;
          await maybeRefreshImportProgress();

        } catch (error) {
          // Rollback only this row's changes and continue
          try {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            await client.query(`RELEASE SAVEPOINT ${savepointName}`);
          } catch (spErr) {
            logger.error('Failed to rollback to savepoint', { rowNumber: i + 1, error: spErr });
          }

          failedRecords++;
          const errObj: any = error as any;
          const detailedMsg = errObj?.detail ? ` - ${errObj.detail}` : '';
          const errorMsg = `Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}${detailedMsg}`;
          errors.push(errorMsg);
          logger.error('Failed to process row', { rowNumber: i + 1, error });

          // Persist failure status and specific error message for this row
          if (rawDataId) {
            try {
              await client.query(
                `UPDATE sap_raw_data SET status = 'failed', error_message = $1 WHERE id = $2`,
                [errorMsg, rawDataId]
              );
            } catch (updateErr) {
              logger.error('Failed to record row error to sap_raw_data', { rawDataId, updateErr });
            }
          }
          await maybeRefreshImportProgress();
        }
      }
      
      // 7. Update import status
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

      if (processedRecords > 0) {
        invalidateShipmentsListCache();
        setImmediate(() => {
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
      }
      
      logger.info('SAP MASTER v2 import completed', {
        importId,
        processedRecords,
        failedRecords,
        skippedRecords,
        summary
      });
      
      return {
        success: true,
        importId,
        totalRecords: validDataRows.length,
        processedRecords,
        failedRecords,
        skippedRecords,
        errors: errors.length > 0 ? errors.slice(0, 100) : undefined, // Limit to first 100 errors
        summary
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('SAP MASTER v2 import failed', { importId, error });
      await this.markImportFailed(importId, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Parse field metadata from header rows
   */
  private static parseFieldMetadata(jsonData: any[][], config: MasterV2Config = this.DEFAULT_CONFIG): FieldMetadata[] {
    const metadata: FieldMetadata[] = [];
    
    const legendRow1 = jsonData[config.legendRow1] || [];
    const legendRow2 = jsonData[config.legendRow2] || [];
    const headerRow = jsonData[config.headerRow] || [];
    const sapFieldRow1 = jsonData[config.sapFieldRow1] || [];
    const sapFieldRow2 = jsonData[config.sapFieldRow2] || [];
    
    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      
      const sapSource1 = sapFieldRow1[i] || '';
      const sapSource2 = sapFieldRow2[i] || '';
      const legend1 = legendRow1[i] || '';
      const legend2 = legendRow2[i] || '';
      
      // Determine user role from legend
      const userRole = this.determineUserRole(legend1, legend2);
      
      // Determine if field is from SAP, manual, or calculated
      const isFromSap = this.isFromSapSource(sapSource1, sapSource2);
      const isManualEntry = this.isManualEntryField(sapSource1, sapSource2);
      const isCalculated = this.isCalculatedField(sapSource1, sapSource2);
      
      // Always add metadata for ALL columns to keep indices aligned
      // Even if header is null/empty
      metadata.push({
        columnIndex: i,
        index: i, // Add index property
        headerName: header || `Column_${i}`, // Use placeholder for empty headers
        sapSource1,
        sapSource2,
        userRole,
        isFromSap,
        isManualEntry,
        isCalculated
      });
    }
    
    return metadata;
  }
  
  /**
   * Determine user role from legend rows
   */
  private static determineUserRole(legend1: string, legend2: string): string {
    const combined = `${legend1} ${legend2}`.toLowerCase();
    
    if (combined.includes('trader')) return 'TRADING';
    if (combined.includes('logistics trucking')) return 'LOGISTICS_TRUCKING';
    if (combined.includes('logistics shipping')) return 'LOGISTICS_SHIPPING';
    if (combined.includes('quality')) return 'QUALITY';
    if (combined.includes('finance')) return 'FINANCE';
    if (combined.includes('admin')) return 'ADMIN';
    if (combined.includes('management')) return 'MANAGEMENT';
    if (combined.includes('database')) return 'SYSTEM';
    if (combined === 'all') return 'ALL';
    
    return 'GENERAL';
  }
  
  /**
   * Check if field is from SAP
   */
  private static isFromSapSource(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('get data') || 
           combined.includes('using') ||
           (combined.length > 0 && 
            !combined.includes('offline') && 
            !combined.includes('formulasi') &&
            !combined.includes('skip'));
  }
  
  /**
   * Check if field requires manual entry
   */
  private static isManualEntryField(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('offline') || combined.trim() === '';
  }
  
  /**
   * Check if field is calculated
   */
  private static isCalculatedField(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('formulasi') || combined.includes('formula');
  }
  
  /**
   * Parse a data row into structured object
   */
  private static parseDataRow(row: any[], fieldMetadata: FieldMetadata[]): any {
    const parsed: any = {
      contract: {},
      shipment: {},
      quality: [],
      trucking: [],
      payment: {},
      vessel: {},
      raw: {}
    };
    
    // Create raw object with field names mapped to values
    for (let index = 0; index < row.length; index++) {
      const value = row[index];
      
      if (index >= fieldMetadata.length) continue;
      
      const field = fieldMetadata[index];
      if (!field || !field.headerName) continue;
      
      const fieldName = field.headerName;
      
      // Store in raw object with proper field name
        if (fieldName && fieldName.trim() !== '') {
        parsed.raw[fieldName] = value;
        applySapMasterV2RawFieldAliases(parsed.raw, fieldName, value);

        // Categorize by type - STO should go to shipment first
        const normalizedFieldName = this.normalizeFieldName(fieldName);
        
        if (fieldName.toLowerCase().includes('sto no') || fieldName.toLowerCase().includes('sto number')) {
          parsed.shipment[normalizedFieldName] = value;
        } else if (this.isContractField(fieldName)) {
          parsed.contract[normalizedFieldName] = value;
        } else if (isTruckingQuantityField(fieldName)) {
          this.addTruckingData(parsed.trucking, fieldName, value);
        } else if (this.isShipmentField(fieldName)) {
          parsed.shipment[normalizedFieldName] = value;
        } else if (this.isQualityField(fieldName)) {
          this.addQualityData(parsed.quality, fieldName, value);
        } else if (this.isTruckingField(fieldName)) {
          this.addTruckingData(parsed.trucking, fieldName, value);
        } else if (this.isPaymentField(fieldName)) {
          parsed.payment[normalizedFieldName] = value;
        } else if (this.isVesselField(fieldName)) {
          parsed.vessel[normalizedFieldName] = value;
        }
      }
    }
    
    return parsed;
  }
  
  /**
   * Helper functions to categorize fields
   */
  private static isContractField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    const contractFields = [
      'group', 'supplier', 'buyer', 'contract date', 'product', 'contract no', 'po no',
      'incoterm', 'incoterms', // Handle both singular and plural
      'sea / land', 'sea/land', // Handle with and without spaces
      'contract quantity', 'unit price', 'due date delivery',
      'source', 'ltc / spot', 'lt/spot', // Handle with and without space
      'status', 'gr po status', 'gr sto status', 'sto no', 'sto quantity', 'classification',
      'b2b flag', 'contract type', 'contract reff po', 'contract reff po ini', 'contract reff so ini',
      'contract ref po', 'contract ref po initial', 'contract ref so initial',
      'contract ext no', 'company code', 'plant code', 'vendor group',
    ];
    return contractFields.some(cf => lower.includes(cf));
  }
  
  private static isShipmentField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    if (isTruckingQuantityField(fieldName)) return false;
    const shipmentFields = [
      'vessel', 'voyage', 'loading port', 'discharge port', 'eta', 'ata',
      'berthed', 'sailed', 'arrival', 'quantity at', 'sto', 'shipment',
      'qty deliver', 'quantity delivery', 'qty receive', 'quantity receive', 'last receive',
      'sto item',
      'ship figure', 'sfal', 'sfbd',
      'transit destination', 'discharge destination',
    ];
    return shipmentFields.some(sf => lower.includes(sf));
  }
  
  private static isQualityField(fieldName: string): boolean {
    const qualityFields = ['ffa', 'm&i', 'm & i', 'dobi', 'iv', 'color', 'red', 'd&s', 'd& s', 'stone'];
    return qualityFields.some(qf => fieldName.toLowerCase().includes(qf));
  }
  
  private static isTruckingField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    if (isTruckingQuantityField(fieldName)) return true;
    return lower.includes('truck') ||
           lower.includes('trucking') ||
           lower.includes('cargo readiness') ||
           (lower.includes('qty deliver') && !lower.includes('vessel')) ||
           (lower.includes('qty receive') && !lower.includes('vessel')) ||
           lower.includes('selisih qty');
  }
  
  private static isPaymentField(fieldName: string): boolean {
    return fieldName.toLowerCase().includes('payment') || 
           fieldName.toLowerCase().includes('dp date') ||
           fieldName.toLowerCase().includes('payoff');
  }
  
  private static isVesselField(fieldName: string): boolean {
    const vesselFields = ['vessel', 'voyage', 'charter', 'loa', 'draft', 'hull'];
    return vesselFields.some(vf => fieldName.toLowerCase().includes(vf));
  }
  
  /**
   * Normalize field names for database columns
   */
  private static normalizeFieldName(fieldName: string): string {
    // Clean the field name first: remove line breaks, extra spaces, and special chars
    let cleanFieldName = fieldName
      .replace(/\r\n/g, ' ')  // Replace line breaks with space
      .replace(/\n/g, ' ')     // Replace newlines with space
      .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
      .trim()                  // Trim leading/trailing spaces
      .toLowerCase();
    
    // Comprehensive field mapping with exact Excel column names
    const fieldMapping: { [key: string]: string } = {
      // TRADING FIELDS
      'group': 'group',
      'supplier (vendor -> name 1))': 'supplier',
      'supplier': 'supplier',
      'vendor': 'supplier',
      'name 1': 'supplier',
      'vendor group': 'group',
      
      'contract date (sama dengan po date)': 'contract_date',
      'contract date': 'contract_date',
      'po date': 'contract_date',
      
      'product (material desc)': 'product',
      'product': 'product',
      'material desc': 'product',
      'material': 'product',
      
      // CRITICAL: Contract No and PO No are DIFFERENT fields!
      'contract no. (no contract) ini nomer kontrak auto generate': 'contract_no',
      'contract no.': 'contract_no',
      'contract no': 'contract_no',
      'contract number': 'contract_no',
      'no contract': 'contract_no',
      
      'po no.': 'po_no',
      'po no': 'po_no',
      'po number': 'po_no',
      
      // NEW: Buyer field (Column F)
      'buyer': 'buyer',
      
      // UPDATED: B2B Flag → Contract Type (Column J)
      'b2b flag': 'contract_type',
      'contract type': 'contract_type',
      
      // UPDATED: CONTRACT REFF PO → Contract Reff PO Ini (Column K)
      'contract reff po': 'contract_reference_po',
      'contract reff po ini': 'contract_reference_po',
      'contract ref po': 'contract_reference_po',
      
      // NEW: Contract Reff SO Ini (Column L)
      'contract reff so ini': 'contract_reference_so',
      'contract ref so ini': 'contract_reference_so',
      'contract reff so': 'contract_reference_so',
      
      'company code': 'company_code',
      'company code.': 'company_code',

      'plant code': 'plant_code',
      'plant code.': 'plant_code',
      
      'incoterm at starting point 1': 'incoterm_starting_1',
      'incoterm at starting point 2': 'incoterm_starting_2',
      'incoterm at starting point 3': 'incoterm_starting_3',
      'incoterm at loading port 2': 'incoterm_loading_2',
      'incoterm': 'incoterm',
      'incoterms': 'incoterm', // Handle plural form
      
      'sea / land': 'sea_land',
      'sea/land': 'sea_land', // Handle without spaces
      'transport': 'sea_land',
      
      'contract quantity (or po qty)': 'contract_quantity',
      'contract quantity': 'contract_quantity',
      'po qty': 'contract_quantity',
      
      'unit price': 'unit_price',
      'price': 'unit_price',
      
      'due date delivery (start)': 'due_date_delivery_start',
      'due date delivery (end)': 'due_date_delivery_end',
      'due date delivery': 'due_date_delivery_start',
      
      'source (3rd party/inhouse)': 'source',
      'source': 'source',
      '3rd party': 'source',
      'inhouse': 'source',
      
      'ltc / spot': 'ltc_spot',
      'lt/spot': 'ltc_spot', // Handle without space
      'ltc': 'ltc_spot',
      'spot': 'ltc_spot',
      
      'status': 'status',
      
      // LOGISTICS FIELDS
      'sto no.': 'sto_no',
      'sto no': 'sto_no',
      'sto number': 'sto_no',
      'sto type': 'sto_type',
      
      // NEW: STO Item (Column W)
      'sto item': 'sto_item',
      
      'sto quantity': 'sto_quantity',
      
      'logistics area classification': 'logistics_area_classification',
      // UPDATED: PO Classification → STO Classification (Column Z)
      'po classification': 'sto_classification',
      'sto classification': 'sto_classification',
      
      // FINANCE FIELDS
      'due date payment': 'due_date_payment',
      'dp date': 'dp_date',
      'payoff date': 'payoff_date',
      'payment date deviation (days)': 'payment_date_deviation_days',
      // UPDATED: Simplified field names and new positions
      'dp date deviation (days) dp date - due date': 'dp_date_deviation_days',
      'dp date - due date': 'dp_date_deviation_days', // New position (Column AF)
      'payoff date deviation (days) payoff date - due date': 'payoff_date_deviation_days',
      'payoff date - due date': 'payoff_date_deviation_days', // New position (Column AG)
      
      // TRUCKING FIELDS
      'cargo readiness at starting location': 'cargo_readiness_at_starting_location',
      'cargo readiness at starting location 2': 'cargo_readiness_at_starting_location_2',
      'cargo readiness at starting location 3': 'cargo_readiness_at_starting_location_3',
      'cargo readiness at loading port 1': 'cargo_readiness_at_loading_port_1',
      'cargo readiness at loading port 2': 'cargo_readiness_at_loading_port_2',
      'cargo readiness at loading port 3': 'cargo_readiness_at_loading_port_3',
      
      'truck loading at starting location': 'truck_loading_at_starting_location',
      'truck loading at starting location 2': 'truck_loading_at_starting_location_2',
      'truck loading at starting location 3': 'truck_loading_at_starting_location_3',
      'truck loading at discharge location': 'truck_loading_at_discharge_location',
      
      'truck unloading at starting location': 'truck_unloading_at_starting_location',
      'truck unloading at starting location 2': 'truck_unloading_at_starting_location_2',
      'truck unloading at starting location 3': 'truck_unloading_at_starting_location_3',
      'truck unloading at discharge location': 'truck_unloading_at_discharge_location',
      // UPDATED: Column positions changed (AH, AI, AJ, AK, AL, AM)
      'truck loading location': 'truck_loading_at_starting_location', // Column AH
      'truck discharge location': 'truck_unloading_at_starting_location', // Column AI
      
      'trucking owner at starting location': 'trucking_owner_at_starting_location',
      'trucking owner at starting location 2': 'trucking_owner_at_starting_location_2',
      'trucking owner at starting location 3': 'trucking_owner_at_starting_location_3',
      'truck owner at discharge': 'truck_owner_at_discharge',
      'truck transporter': 'trucking_owner_at_starting_location', // Column AJ
      
      'trucking oa budget at starting location': 'trucking_oa_budget_at_starting_location',
      'trucking oa budget at starting location 2': 'trucking_oa_budget_at_starting_location_2',
      'trucking oa budget at starting location 3': 'trucking_oa_budget_at_starting_location_3',
      'trucking oa budget at discharge': 'trucking_oa_budget_at_discharge',
      'truck oa budget': 'trucking_oa_budget_at_starting_location', // Column AL
      'trucking oa budget': 'trucking_oa_budget_at_starting_location', // Column AL
      'estimated km': 'estimated_km', // Column AM
      'esimated km': 'estimated_km',
      
      'trucking oa actual at starting location': 'trucking_oa_actual_at_starting_location',
      'trucking oa actual at starting location 2': 'trucking_oa_actual_at_starting_location_2',
      'trucking oa actual at starting location 3': 'trucking_oa_actual_at_starting_location_3',
      'trucking oa actual at discharge': 'trucking_oa_actual_at_discharge',
      'trucking oa actual': 'trucking_oa_actual_at_starting_location', // Column AK
      
      'quantity sent via trucking (based on surat jalan)': 'quantity_sent_via_trucking_based_on_surat_jalan',
      'quantity delivered via trucking': 'quantity_delivered_via_trucking',
      'selisih': 'trucking_gain_loss',
      'trucking gain/loss at starting location': 'trucking_gain_loss_at_starting_location',
      // UPDATED: QTY DELIVER → Quantity Delivery (Column AD)
      'qty deliver': 'quantity_delivery',
      'quantity delivery': 'quantity_delivery',
      'qty receive': 'quantity_delivered_via_trucking',
      'selisih qty receive vs qty deliver': 'trucking_gain_loss_at_starting_location',
      
      'trucking starting date at starting location': 'trucking_starting_date_at_starting_location',
      'trucking starting date at starting location 2': 'trucking_starting_date_at_starting_location_2',
      'trucking starting date at starting location 3': 'trucking_starting_date_at_starting_location_3',
      // UPDATED: Trucking Load Port Start Date → Trucking Start Receive Date (Column AV)
      'trucking load port start date': 'trucking_start_receive_date',
      'trucking start receive date': 'trucking_start_receive_date', // Column AV
      
      'trucking completion date at starting location': 'trucking_completion_date_at_starting_location',
      'trucking completion date at starting location 2': 'trucking_completion_date_at_starting_location_2',
      'trucking completion date at starting location 3': 'trucking_completion_date_at_starting_location_3',
      // UPDATED: Trucking Load Port End Date → Trucking Last Receive Date (Column AW)
      'trucking load port end date': 'trucking_last_receive_date',
      'trucking last receive date': 'trucking_last_receive_date', // Column AW
      'last receive date': 'last_receive_date',
      
      // SHIPPING/VESSEL FIELDS
      'loading method (pipeline / trucking)': 'loading_method',
      // UPDATED: Column positions changed (AN, AO, AP, AQ, AR, AS, AT, AU)
      'vessel loading port': 'vessel_loading_port_1',
      'vessel loading port 1': 'vessel_loading_port_1', // Column AN
      'vessel loading port 2': 'vessel_loading_port_2',
      'vessel loading port 3': 'vessel_loading_port_3',
      'vessel discharge port': 'vessel_discharge_port', // Column AO
      'discharge method (pipeline / trucking)': 'discharge_method',
      
      'voyage no.': 'voyage_no',
      // UPDATED: Vessel fields moved (AP, AQ, AR, AS, AT, AU)
      'vessel name': 'vessel_name', // Column AP
      'vessel company': 'vessel_owner', // Column AQ
      'vessel owner': 'vessel_owner',
      'vessel oa actual': 'vessel_oa_actual', // Column AR
      'vessel oa actual ': 'vessel_oa_actual',
      'vessel oa budget': 'vessel_oa_budget', // Column AS
      'vessell oa budget': 'vessel_oa_budget',
      'estimated nm': 'estimated_nautical_miles', // Column AT
      'estimated nautical miles': 'estimated_nautical_miles',
      'vessel code': 'vessel_code', // Column AU
      // Vessel physical properties moved later (BT-BX)
      'vessel draft': 'vessel_draft',
      'loa': 'vessel_loa',
      'vessel capacity': 'vessel_capacity',
      'vessel cappacity': 'vessel_capacity', // Typo handling
      'vessel hull type': 'vessel_hull_type',
      'vessel registration year': 'vessel_registration_year',
      'charter type (vc / tc / mix)': 'charter_type',
      'average vessel speed': 'average_vessel_speed', // Column BY
      
      // QUANTITY FIELDS
      'quantity at loading port 1 (based on bast)': 'quantity_at_loading_port_1_based_on_bast',
      'quantity at loading port 2': 'quantity_at_loading_port_2',
      'quantity at loading port 3': 'quantity_at_loading_port_3',
      'quantity at starting location 2': 'quantity_at_starting_location_2',
      'quantity at starting location 3': 'quantity_at_starting_location_3',
      'actual quantity (at final location)': 'actual_quantity_at_final_location',
      // UPDATED: B/L Quantity moved to Column BG
      'b/l quantity': 'bl_quantity', // Column BG
      'b/l quantity ': 'bl_quantity',
      'actual vessel qty receive': 'actual_vessel_qty_receive',
      'difference final qty - bl qty': 'difference_final_qty_vs_bl_qty',
      'difference  final qty - bl qty ': 'difference_final_qty_vs_bl_qty',
      'ship figure after loading (sfal)': 'sfal',
      'ship figure before discharge (sfbd)': 'sfbd',
      
      // ETA/ATA FIELDS - Loading Port 1
      'eta vessel arrival loading port 1': 'eta_vessel_arrival_loading_port_1',
      // UPDATED: ATA fields moved (AX, AY, AZ, BA, BB)
      'ata vessel arrival at loading port': 'ata_vessel_arrival_at_loading_port_1', // Column AX
      'ata vessel arrival at loading port 1': 'ata_vessel_arrival_at_loading_port_1',
      'ata vessel berthed at loading port': 'ata_vessel_berthed_at_loading_port_1', // Column AY
      'ata vessel berthed at loading port 1': 'ata_vessel_berthed_at_loading_port_1',
      'eta loading start at loading port 1': 'eta_loading_start_at_loading_port_1',
      'ata vessel start loading': 'ata_vessel_start_loading', // Column AZ
      'ata loading start at loading port 1': 'ata_vessel_start_loading',
      'eta loading completed at loading port 1': 'eta_loading_completed_at_loading_port_1',
      'ata vessel completed loading': 'ata_vessel_completed_loading', // Column BA
      'ata loading completed at loading port 1': 'ata_vessel_completed_loading',
      'eta vessel sailed at loading port 1': 'eta_vessel_sailed_at_loading_port_1',
      'ata vessel sailed from loading port': 'ata_vessel_sailed_from_loading_port', // Column BB
      'ata vessel sailed at loading port 1': 'ata_vessel_sailed_from_loading_port',
      'loading rate at loading port 1': 'loading_rate_at_loading_port_1',
      
      // ETA/ATA FIELDS - Loading Port 2
      'eta vessel arrival at loading port 2': 'eta_vessel_arrival_at_loading_port_2',
      'ata vessel arrival at loading port 2': 'ata_vessel_arrival_at_loading_port_2',
      'eta vessel berthed at loading port 2': 'eta_vessel_berthed_at_loading_port_2',
      'ata vessel berthed at loading port 2': 'ata_vessel_berthed_at_loading_port_2',
      'eta loading start at loading port 2': 'eta_loading_start_at_loading_port_2',
      'ata loading start at loading port 2': 'ata_loading_start_at_loading_port_2',
      'eta loading completed at loading port 2': 'eta_loading_completed_at_loading_port_2',
      'ata loading completed at loading port 2': 'ata_loading_completed_at_loading_port_2',
      'eta vessel sailed at loading port 2': 'eta_vessel_sailed_at_loading_port_2',
      'ata vessel sailed at loading port 2': 'ata_vessel_sailed_at_loading_port_2',
      'loading rate at loading port 2': 'loading_rate_at_loading_port_2',
      
      // ETA/ATA FIELDS - Loading Port 3
      'eta vessel arrival at loading port 3': 'eta_vessel_arrival_at_loading_port_3',
      'ata vessel arrival at loading port 3': 'ata_vessel_arrival_at_loading_port_3',
      'eta vessel berthed at loading port 3': 'eta_vessel_berthed_at_loading_port_3',
      'ata vessel berthed at loading port 3': 'ata_vessel_berthed_at_loading_port_3',
      'eta loading start at loading port 3': 'eta_loading_start_at_loading_port_3',
      'ata loading start at loading port 3': 'ata_loading_start_at_loading_port_3',
      'eta loading completed at loading port 3': 'eta_loading_completed_at_loading_port_3',
      'ata loading completed at loading port 3': 'ata_loading_completed_at_loading_port_3',
      'eta vessel sailed at loading port 3': 'eta_vessel_sailed_at_loading_port_3',
      'ata vessel sailed at loading port 3': 'ata_vessel_sailed_at_loading_port_3',
      'loading rate at loading port 3': 'loading_rate_at_loading_port_3',
      
      // ETA/ATA FIELDS - Discharge Port
      'eta arrival at discharge port': 'eta_arrival_at_discharge_port',
      // UPDATED: ATA discharge fields moved (BC, BD, BE, BF)
      'ata vessel arrive at discharge port': 'ata_vessel_arrival_at_discharge_port', // Column BC
      'ata vessel arrival at discharge port': 'ata_vessel_arrival_at_discharge_port',
      'eta vessel berthed at discharge port': 'eta_vessel_berthed_at_discharge_port',
      'ata vessel berthed at discharge port': 'ata_vessel_berthed_at_discharge_port', // Column BD
      'eta discharging start at discharge port': 'eta_discharging_start_at_discharge_port',
      'ata vessel start discharging': 'ata_vessel_start_discharging', // Column BE
      'ata discharging start at discharge port': 'ata_vessel_start_discharging',
      'eta discharging completed at discharge port': 'eta_discharging_completed_at_discharge_port',
      'ata vessel complete discharge': 'ata_vessel_completed_discharge', // Column BF
      'ata discharging completed at discharge port': 'ata_vessel_completed_discharge',
      'discharge rate at discharging port': 'discharge_rate_at_discharging_port',
      
      // QUALITY FIELDS - Updated column positions
      // Loading Loc 1 Quality (Columns BH-BM, moved from BL-BM)
      'quality at loading loc 1 ffa': 'ffa',
      'quality at loading location 1 ffa': 'ffa',
      'quality at loading port 1 ffa': 'ffa',
      'loading loc 1 ffa': 'ffa',
      'quality at loading loc 1 m&i': 'moisture',
      'quality at loading loc 1 m & i': 'moisture',
      'quality at loading location 1 m&i': 'moisture',
      'quality at loading location 1 m & i': 'moisture',
      'quality at loading port 1 m&i': 'moisture',
      'loading loc 1 m&i': 'moisture',
      'quality at loading loc 1 dobi': 'dobi',
      'quality at loading location 1 dobi': 'dobi',
      'quality at loading port 1 dobi': 'dobi',
      'loading loc 1 dobi': 'dobi',
      'quality at loading loc 1 red': 'color_red',
      'quality at loading location 1 red': 'color_red',
      'quality at loading port 1 red': 'color_red',
      'loading loc 1 red': 'color_red',
      'quality at loading loc 1 d&s': 'd_and_s',
      'quality at loading location 1 d&s': 'd_and_s',
      'quality at loading port 1 d&s': 'd_and_s',
      'loading loc 1 d&s': 'd_and_s',
      'quality at loading loc 1 stone': 'stone',
      'quality at loading location 1 stone': 'stone',
      'quality at loading port 1 stone': 'stone',
      'loading loc 1 stone': 'stone',
      
      // Discharge Port Quality (Columns BN-BS, moved from BR-BW)
      'quality at discharge port ffa': 'ffa',
      'discharge port ffa': 'ffa',
      'quality at discharge port m&i': 'moisture',
      'discharge port m&i': 'moisture',
      'quality at discharge port dobi': 'dobi',
      'discharge port dobi': 'dobi',
      'quality at discharge port red': 'color_red',
      'discharge port red': 'color_red',
      'quality at discharge port d&s': 'd_and_s',
      'discharge port d&s': 'd_and_s',
      'quality at discharge port stone': 'stone',
      'discharge port stone': 'stone'
    };
    
    // Check for exact match first
    const mergedMapping = { ...fieldMapping, ...SAP_MASTER_V2_UAT_FIELD_MAPPING };

    if (mergedMapping[cleanFieldName]) {
      return mergedMapping[cleanFieldName];
    }
    
    // Check for partial matches with priority order
    const priorityKeys = [
      'contract no.',
      'po no.',
      'sto no.',
      'contract quantity',
      'sto quantity',
      'vessel name'
    ];
    
    for (const key of priorityKeys) {
      if (cleanFieldName.includes(key)) {
        return mergedMapping[key];
      }
    }
    
    // Check for general partial matches
    for (const [key, value] of Object.entries(mergedMapping)) {
      if (cleanFieldName.includes(key) || key.includes(cleanFieldName)) {
        return value;
      }
    }
    
    // Fallback: convert to snake_case
    return cleanFieldName
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  
  /**
   * Add quality data (handles multiple locations)
   */
  private static addQualityData(qualityArray: any[], fieldName: string, value: any): void {
    const location = resolveSapMasterV2QualityLocation(fieldName);
    
    // Find or create quality record for this location
    let qualityRecord = qualityArray.find(q => q.location === location);
    if (!qualityRecord) {
      qualityRecord = { location, data: {} };
      qualityArray.push(qualityRecord);
    }
    
    qualityRecord.data[this.normalizeFieldName(fieldName)] = value;
  }
  
  /**
   * Add trucking data (handles multiple locations)
   */
  private static addTruckingData(truckingArray: any[], fieldName: string, value: any): void {
    // Determine sequence from field name
    let sequence = 1;
    if (fieldName.includes('Location 2') || fieldName.includes('Port 2')) {
      sequence = 2;
    } else if (fieldName.includes('Location 3') || fieldName.includes('Port 3')) {
      sequence = 3;
    }
    
    // Find or create trucking record for this sequence
    let truckingRecord = truckingArray.find(t => t.sequence === sequence);
    if (!truckingRecord) {
      truckingRecord = { sequence, data: {} };
      truckingArray.push(truckingRecord);
    }
    
    truckingRecord.data[this.normalizeFieldName(fieldName)] = value;
  }
  
  /**
   * Store processed data in sap_processed_data table
   */
  private static async storeProcessedData(
    client: any,
    importId: string,
    rawDataId: string,
    parsedData: any
  ): Promise<void> {
    // Use normalized contract data instead of raw field names
    const contract = parsedData.contract || {};
    const shipment = parsedData.shipment || {};
    const vessel = parsedData.vessel || {};
    
    // Extract values from normalized objects
    const contractNumber = contract.contract_no || null;
    const poNumber = contract.po_no || null;
    const stoNumber = shipment.sto_no || contract.sto_no || null; // STO is in shipment, fallback to contract
    if (!normalizePoNumber(poNumber)) {
      throw new Error('PO number is required for sap_processed_data');
    }
    const shipmentId = shipment.shipment_id || shipment.id || stoNumber || null;
    const supplierName = contract.supplier || null;
    const product = contract.product || null;
    const vesselName = vessel.vessel_name || vessel.name || shipment.vessel || null;
    const incoterm = contract.incoterm || null;
    const transportMode = contract.sea_land || contract.transport_mode || null;

    await client.query(
      `INSERT INTO sap_processed_data 
       (import_id, raw_data_id, contract_number, shipment_id, po_number, sto_number,
        supplier_name, product, vessel_name, incoterm, transport_mode, data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        importId,
        rawDataId,
        contractNumber,
        shipmentId || stoNumber, // Use STO as shipment ID if no shipment ID
        poNumber,
        stoNumber,
        supplierName,
        product,
        vesselName,
        incoterm,
        transportMode,
        JSON.stringify(parsedData)
      ]
    );
  }
  
  /**
   * Distribute data to main tables (contracts, shipments, etc.)
   */
  private static async distributeToTables(client: any, parsedData: any): Promise<any> {
    try {
      // Use the distribution service to create/update records
      const distributionResult = await SapDataDistributionService.distributeData(
        client,
        parsedData,
        undefined // userId - can be passed from import context
      );

      return {
        contractCreated: !!distributionResult.contractId,
        shipmentCreated: !!distributionResult.shipmentId,
        qualitySurveysCreated: distributionResult.qualitySurveyIds.length,
        truckingOperationsCreated: distributionResult.truckingOperationIds.length,
        paymentCreated: !!distributionResult.paymentId,
      };
    } catch (error) {
      // Important: rethrow so the caller can rollback to the row SAVEPOINT.
      // If we swallow the error, Postgres marks the transaction as aborted and subsequent commands fail
      // with "current transaction is aborted...".
      logger.error('Data distribution failed', error);
      throw error;
    }
  }

  /** Parse one SAP MASTER v2 row (for tests and diagnostics). */
  static parseDataRowForTest(row: unknown[], fieldMetadata: FieldMetadata[]): Record<string, unknown> {
    return this.parseDataRow(row as any[], fieldMetadata);
  }
}

