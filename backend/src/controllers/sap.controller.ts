import { Response } from 'express';
import { AuthRequest } from '../types/auth';
import pool from '../database/connection';
import { SapImportService } from '../services/sapImport.service';
import logger from '../utils/logger';

// SAP Data Import Controller
export const importSapData = async (req: AuthRequest, res: Response) => {
  try {
    const { data, importDate } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No data provided for import' }
      });
    }

    logger.info(`Starting SAP import with ${data.length} rows`, {
      importDate,
      userId: req.user?.id,
      username: req.user?.username
    });

    // Delegate to robust service (with transaction + savepoints)
    const result = await SapImportService.importSapData(data, importDate);

    logger.info('SAP data import finished', {
      importId: result.importId,
      totalRecords: result.totalRecords,
      processedRecords: result.processedRecords,
      failedRecords: result.failedRecords,
      hasErrors: (result.errors?.length || 0) > 0
    });

    return res.status(201).json({
      success: true,
      data: {
        importId: result.importId,
        totalRecords: result.totalRecords,
        processedRecords: result.processedRecords,
        failedRecords: result.failedRecords,
        errors: result.errors || []
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    
    logger.error('SAP data import failed catastrophically:', {
      error: errorMsg,
      stack: errorStack,
      userId: req.user?.id
    });
    
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to import SAP data', 
        details: errorMsg 
      }
    });
  }
};

// Get Import History
export const getImportHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = `
      SELECT id, import_date, import_timestamp, status, total_records, 
             processed_records, failed_records, created_at
      FROM sap_data_imports
    `;
    const params: any[] = [];
    
    if (status) {
      query += ` WHERE status = $1`;
      params.push(status);
    }
    
    query += ` ORDER BY import_timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), offset);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: {
        imports: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.rows.length
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get import history:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get import history' }
    });
  }
};

// Get Import Details
export const getImportDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const importResult = await pool.query(
      `SELECT * FROM sap_data_imports WHERE id = $1`,
      [id]
    );
    
    if (importResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Import not found' }
      });
    }
    
    const rawDataResult = await pool.query(
      `SELECT * FROM sap_raw_data WHERE import_id = $1 ORDER BY row_number`,
      [id]
    );
    
    return res.json({
      success: true,
      data: {
        import: importResult.rows[0],
        rawData: rawDataResult.rows
      }
    });
  } catch (error) {
    logger.error('Failed to get import details:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to get import details' }
    });
  }
};

// Get Processed Data
export const getProcessedData = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, userRole, status, dateFrom, dateTo } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = `
      SELECT spd.*, sdi.import_date
      FROM sap_processed_data spd
      JOIN sap_data_imports sdi ON spd.import_id = sdi.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (userRole) {
      paramCount++;
      query += ` AND spd.data->>'user_role' = $${paramCount}`;
      params.push(userRole);
    }
    
    if (status) {
      paramCount++;
      query += ` AND spd.status = $${paramCount}`;
      params.push(status);
    }
    
    if (dateFrom) {
      paramCount++;
      query += ` AND sdi.import_date >= $${paramCount}`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      paramCount++;
      query += ` AND sdi.import_date <= $${paramCount}`;
      params.push(dateTo);
    }
    
    query += ` ORDER BY sdi.import_date DESC, spd.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(Number(limit), offset);
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: {
        processedData: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.rows.length
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get processed data:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get processed data' }
    });
  }
};

// Create User Input
export const createUserInput = async (req: AuthRequest, res: Response) => {
  try {
    const { processedDataId, fieldName, fieldValue, inputType, comments } = req.body;
    
    const result = await pool.query(
      `INSERT INTO user_data_inputs 
       (processed_data_id, user_id, field_name, field_value, input_type, comments) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [processedDataId, req.user?.id, fieldName, fieldValue, inputType, comments]
    );
    
    logger.info(`User input created: ${result.rows[0].id}`, { 
      userId: req.user?.id, 
      fieldName, 
      processedDataId 
    });
    
    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to create user input:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create user input' }
    });
  }
};

// Get Field Mappings
export const getFieldMappings = async (req: AuthRequest, res: Response) => {
  try {
    const { userRole } = req.query;
    
    let query = `SELECT * FROM sap_field_mappings`;
    const params: any[] = [];
    
    if (userRole) {
      query += ` WHERE user_role = $1`;
      params.push(userRole);
    }
    
    query += ` ORDER BY sort_order, sap_field_name`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Failed to get field mappings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get field mappings' }
    });
  }
};

// Get SAP Dashboard
export const getSapDashboard = async (_req: AuthRequest, res: Response) => {
  try {
    // Get import statistics
    const importStats = await pool.query(`
      SELECT 
        COUNT(*) as total_imports,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_imports,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_imports,
        SUM(total_records) as total_records,
        SUM(processed_records) as processed_records
      FROM sap_data_imports
      WHERE import_date >= CURRENT_DATE - INTERVAL '30 days'
    `);
    
    // Get recent imports
    const recentImports = await pool.query(`
      SELECT id, import_date, status, total_records, import_timestamp
      FROM sap_data_imports
      ORDER BY import_timestamp DESC
      LIMIT 5
    `);
    
    // Get data by user role
    const dataByRole = await pool.query(`
      SELECT 
        spd.data->>'user_role' as user_role,
        COUNT(*) as record_count
      FROM sap_processed_data spd
      JOIN sap_data_imports sdi ON spd.import_id = sdi.id
      WHERE sdi.import_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY spd.data->>'user_role'
    `);
    
    res.json({
      success: true,
      data: {
        importStats: importStats.rows[0],
        recentImports: recentImports.rows,
        dataByRole: dataByRole.rows
      }
    });
  } catch (error) {
    logger.error('Failed to get SAP dashboard:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get SAP dashboard' }
    });
  }
};

// Placeholder functions for other endpoints
export const deleteImport = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getRawData = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getRawDataById = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const processRawData = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getProcessedDataById = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const updateProcessedData = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getUserInputs = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const updateUserInput = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const deleteUserInput = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const createFieldMapping = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const updateFieldMapping = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const deleteFieldMapping = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getValidationRules = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const createValidationRule = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const updateValidationRule = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const deleteValidationRule = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getSapAnalytics = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};

export const getSapReports = async (_req: AuthRequest, res: Response) => {
  res.status(501).json({ success: false, error: { message: 'Not implemented yet' } });
};
