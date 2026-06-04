import { Response } from 'express';
import { AuthRequest } from '../types/auth';
import { ExcelImportService } from '../services/excelImport.service';
import { SchedulerService } from '../services/scheduler.service';
import logger from '../utils/logger';

/**
 * Import data from Excel file
 */
export const importFromExcel = async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, sheetName, startRow, endRow, columnMappings } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: { message: 'File path is required' }
      });
    }
    
    const config = {
      filePath,
      sheetName,
      startRow: startRow ? parseInt(startRow) : undefined,
      endRow: endRow ? parseInt(endRow) : undefined,
      columnMappings
    };
    
    const result = await ExcelImportService.importFromExcel(config);
    
    logger.info(`Excel import completed by user: ${req.user?.id}`, {
      userId: req.user?.id,
      filePath,
      result
    });
    
    return res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Excel import failed:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to import Excel file',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Import from Logistics Overview file
 */
export const importLogisticsOverview = async (req: AuthRequest, res: Response) => {
  try {
    const result = await ExcelImportService.importLogisticsOverview();
    
    logger.info(`Logistics Overview import completed by user: ${req.user?.id}`, {
      userId: req.user?.id,
      result
    });
    
    return res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Logistics Overview import failed:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to import Logistics Overview file',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Get available sheets from Excel file
 */
export const getSheetNames = async (req: AuthRequest, res: Response) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'File path is required' }
      });
    }
    
    const sheetNames = ExcelImportService.getSheetNames(filePath);
    
    return res.json({
      success: true,
      data: { sheetNames }
    });
    
  } catch (error) {
    logger.error('Failed to get sheet names:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to get sheet names',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Preview Excel data
 */
export const previewExcelData = async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, sheetName, maxRows } = req.query;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'File path is required' }
      });
    }
    
    const preview = ExcelImportService.previewExcelData(
      filePath,
      sheetName as string,
      maxRows ? parseInt(maxRows as string) : 10
    );
    
    return res.json({
      success: true,
      data: { preview }
    });
    
  } catch (error) {
    logger.error('Failed to preview Excel data:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to preview Excel data',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Validate Excel file structure
 */
export const validateExcelStructure = async (req: AuthRequest, res: Response) => {
  try {
    const { filePath, sheetName } = req.query;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'File path is required' }
      });
    }
    
    const validation = ExcelImportService.validateExcelStructure(
      filePath,
      sheetName as string
    );
    
    return res.json({
      success: true,
      data: validation
    });
    
  } catch (error) {
    logger.error('Failed to validate Excel structure:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to validate Excel structure',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Get all scheduled imports
 */
export const getScheduledImports = async (_req: AuthRequest, res: Response) => {
  try {
    const scheduledImports = SchedulerService.getScheduledImports();
    
    return res.json({
      success: true,
      data: { scheduledImports }
    });
    
  } catch (error) {
    logger.error('Failed to get scheduled imports:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to get scheduled imports',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Get a specific scheduled import
 */
export const getScheduledImport = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const scheduledImport = SchedulerService.getScheduledImport(id);
    
    if (!scheduledImport) {
      return res.status(404).json({
        success: false,
        error: { message: 'Scheduled import not found' }
      });
    }
    
    return res.json({
      success: true,
      data: { scheduledImport }
    });
    
  } catch (error) {
    logger.error('Failed to get scheduled import:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to get scheduled import',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Update a scheduled import
 */
export const updateScheduledImport = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const success = SchedulerService.updateScheduledImport(id, updates);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: { message: 'Scheduled import not found' }
      });
    }
    
    logger.info(`Scheduled import updated by user: ${req.user?.id}`, {
      userId: req.user?.id,
      scheduleId: id,
      updates
    });
    
    return res.json({
      success: true,
      data: { message: 'Scheduled import updated successfully' }
    });
    
  } catch (error) {
    logger.error('Failed to update scheduled import:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to update scheduled import',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Delete a scheduled import
 */
export const deleteScheduledImport = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const success = SchedulerService.deleteScheduledImport(id);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: { message: 'Scheduled import not found' }
      });
    }
    
    logger.info(`Scheduled import deleted by user: ${req.user?.id}`, {
      userId: req.user?.id,
      scheduleId: id
    });
    
    return res.json({
      success: true,
      data: { message: 'Scheduled import deleted successfully' }
    });
    
  } catch (error) {
    logger.error('Failed to delete scheduled import:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to delete scheduled import',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Execute a scheduled import manually
 */
export const executeScheduledImportManually = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await SchedulerService.executeScheduledImportManually(id);
    
    logger.info(`Scheduled import executed manually by user: ${req.user?.id}`, {
      userId: req.user?.id,
      scheduleId: id
    });
    
    return res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Failed to execute scheduled import manually:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to execute scheduled import manually',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};

/**
 * Get scheduler status
 */
export const getSchedulerStatus = async (_req: AuthRequest, res: Response) => {
  try {
    const scheduledImports = SchedulerService.getScheduledImports();
    
    const status = {
      isRunning: true,
      totalSchedules: scheduledImports.length,
      activeSchedules: scheduledImports.filter(s => s.isActive).length,
      inactiveSchedules: scheduledImports.filter(s => !s.isActive).length,
      lastUpdated: new Date().toISOString()
    };
    
    return res.json({
      success: true,
      data: status
    });
    
  } catch (error) {
    logger.error('Failed to get scheduler status:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: 'Failed to get scheduler status',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
};
