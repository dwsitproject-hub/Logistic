import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
// import pool from '../database/connection'; // Not used in this service
import logger from '../utils/logger';
import { SapImportService, SapDataRow, SapImportResult } from './sapImport.service';

export interface ExcelImportConfig {
  filePath: string;
  sheetName?: string;
  startRow?: number;
  endRow?: number;
  columnMappings?: { [key: string]: string };
}

export class ExcelImportService {
  
  /**
   * Import data from Excel file
   */
  static async importFromExcel(config: ExcelImportConfig): Promise<SapImportResult> {
    try {
      logger.info(`Starting Excel import from: ${config.filePath}`);
      
      // Check if file exists
      if (!fs.existsSync(config.filePath)) {
        throw new Error(`File not found: ${config.filePath}`);
      }
      
      // Read Excel file
      const workbook = XLSX.readFile(config.filePath);
      
      // Get sheet name (default to first sheet if not specified)
      const sheetName = config.sheetName || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        throw new Error(`Sheet not found: ${sheetName}`);
      }
      
      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        range: config.startRow || 0,
        defval: null
      }) as any[][];
      
      // Process data
      const processedData = this.processExcelData(jsonData, config);
      
      // Import to database using existing SAP import service
      const importResult = await SapImportService.importSapData(
        processedData,
        new Date().toISOString().split('T')[0]
      );
      
      logger.info(`Excel import completed successfully`, {
        filePath: config.filePath,
        totalRecords: processedData.length,
        importId: importResult.importId
      });
      
      return importResult;
      
    } catch (error) {
      logger.error('Excel import failed:', error);
      throw error;
    }
  }
  
  /**
   * Process Excel data and convert to SAP format
   */
  private static processExcelData(
    jsonData: any[][], 
    config: ExcelImportConfig
  ): SapDataRow[] {
    if (jsonData.length < 2) {
      throw new Error('Excel file must have at least a header row and one data row');
    }
    
    const headers = jsonData[0];
    const dataRows = jsonData.slice(1);
    
    // Apply column mappings if provided
    const mappedHeaders = config.columnMappings 
      ? headers.map(header => config.columnMappings![header] || header)
      : headers;
    
    const processedData: SapDataRow[] = [];
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // Skip empty rows
      if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) {
        continue;
      }
      
      const rowData: SapDataRow = {};
      
      // Map each column to its header
      for (let j = 0; j < Math.min(row.length, mappedHeaders.length); j++) {
        const header = mappedHeaders[j];
        const value = row[j];
        
        if (header && value !== null && value !== undefined) {
          rowData[header] = value;
        }
      }
      
      // Only add rows that have some data
      if (Object.keys(rowData).length > 0) {
        processedData.push(rowData);
      }
    }
    
    return processedData;
  }
  
  /**
   * Get available sheets from Excel file
   */
  static getSheetNames(filePath: string): string[] {
    try {
      const workbook = XLSX.readFile(filePath);
      return workbook.SheetNames;
    } catch (error) {
      logger.error('Failed to read Excel file:', error);
      throw error;
    }
  }
  
  /**
   * Preview Excel data (first few rows)
   */
  static previewExcelData(filePath: string, sheetName?: string, maxRows: number = 10): any[][] {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheet = sheetName ? workbook.Sheets[sheetName] : workbook.Sheets[workbook.SheetNames[0]];
      
      if (!sheet) {
        throw new Error(`Sheet not found: ${sheetName || 'first sheet'}`);
      }
      
      const jsonData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null
      }) as any[][];
      
      return jsonData.slice(0, maxRows);
    } catch (error) {
      logger.error('Failed to preview Excel data:', error);
      throw error;
    }
  }
  
  /**
   * Import from the specific Logistics Overview file
   */
  static async importLogisticsOverview(): Promise<SapImportResult> {
    const filePath = path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    
    // Default configuration for the Logistics Overview file
    const config: ExcelImportConfig = {
      filePath,
      sheetName: undefined, // Will use first sheet
      startRow: 0, // Start from first row (header)
      columnMappings: {
        // Map Excel columns to our expected field names
        'Contract Number': 'Contract Number',
        'Trader Name': 'Trader Name',
        'Shipment ID': 'Shipment ID',
        'Logistics Team': 'Logistics Team',
        'Estimated Date': 'Estimated Date',
        'Actual Date': 'Actual Date',
        'Status': 'Status',
        'Priority': 'Priority',
        'Cost': 'Cost',
        'Payment Status': 'Payment Status',
        'Comments': 'Comments',
        'Trader': 'Trader',
        'Trading': 'Trading',
        'Logistics': 'Logistics',
        'Trucking': 'Trucking',
        'Finance': 'Finance',
        'Payment': 'Payment',
        'Management': 'Management',
        'Dashboard': 'Dashboard'
      }
    };
    
    return await this.importFromExcel(config);
  }
  
  /**
   * Validate Excel file structure
   */
  static validateExcelStructure(filePath: string, sheetName?: string): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    sheetNames: string[];
    preview: any[][];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        errors.push(`File not found: ${filePath}`);
        return { isValid: false, errors, warnings, sheetNames: [], preview: [] };
      }
      
      // Read workbook
      const workbook = XLSX.readFile(filePath);
      const sheetNames = workbook.SheetNames;
      
      if (sheetNames.length === 0) {
        errors.push('No sheets found in Excel file');
        return { isValid: false, errors, warnings, sheetNames, preview: [] };
      }
      
      // Get target sheet
      const targetSheetName = sheetName || sheetNames[0];
      const worksheet = workbook.Sheets[targetSheetName];
      
      if (!worksheet) {
        errors.push(`Sheet not found: ${targetSheetName}`);
        return { isValid: false, errors, warnings, sheetNames, preview: [] };
      }
      
      // Convert to JSON for preview
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null
      }) as any[][];
      
      if (jsonData.length < 2) {
        errors.push('Excel file must have at least a header row and one data row');
        return { isValid: false, errors, warnings, sheetNames, preview: jsonData };
      }
      
      const headers = jsonData[0] as any[];
      const dataRows = jsonData.slice(1);
      
      // Validate headers
      if (!headers || headers.length === 0) {
        errors.push('No headers found in the first row');
      }
      
      // Check for empty data rows
      const emptyRows = dataRows.filter((row: any) => 
        !row || row.every((cell: any) => cell === null || cell === undefined || cell === '')
      );
      
      if (emptyRows.length > 0) {
        warnings.push(`${emptyRows.length} empty rows found and will be skipped`);
      }
      
      // Check for required columns (basic validation)
      const requiredColumns = ['Contract Number', 'Trader Name', 'Shipment ID'];
      const missingColumns = requiredColumns.filter(col => 
        !headers.some((header: any) => 
          header && header.toString().toLowerCase().includes(col.toLowerCase())
        )
      );
      
      if (missingColumns.length > 0) {
        warnings.push(`Some recommended columns not found: ${missingColumns.join(', ')}`);
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        sheetNames,
        preview: jsonData.slice(0, 5) // First 5 rows for preview
      };
      
    } catch (error) {
      errors.push(`Failed to validate Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { isValid: false, errors, warnings, sheetNames: [], preview: [] };
    }
  }
}
