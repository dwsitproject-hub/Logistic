import { Request, Response } from 'express';
import { SapMasterV2ImportService } from '../services/sapMasterV2Import.service';
import logger from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

/** Safe fields only — raw pg errors can break JSON.stringify when nested/circular. */
function sapImportHttpError(error: unknown): { message: string; code?: string; detail?: string } {
  if (error instanceof Error) {
    const e = error as Error & { code?: string; detail?: string };
    const body: { message: string; code?: string; detail?: string } = {
      message: e.message || 'Unknown error',
    };
    if (typeof e.code === 'string') body.code = e.code;
    if (typeof e.detail === 'string') body.detail = e.detail;
    return body;
  }
  return { message: typeof error === 'string' ? error : 'Unknown error' };
}

/**
 * Import SAP MASTER v2 data from uploaded file
 */
export const importMasterV2 = async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = req.body.filePath || path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    
    logger.info('Starting SAP MASTER v2 import', { filePath });
    
    const result = await SapMasterV2ImportService.importMasterV2File(filePath);
    
    res.json({
      success: true,
      data: {
        ...result,
        message: result.failedRecords > 0
          ? `Import completed with ${result.processedRecords} processed and ${result.failedRecords} failed.`
          : `Import completed successfully with ${result.processedRecords} records processed.`
      }
    });
    
  } catch (error) {
    logger.error('SAP MASTER v2 import failed', error);
    res.status(500).json({
      success: false,
      error: sapImportHttpError(error),
    });
  }
};

/**
 * Get import status with all records
 */
export const getImportStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { importId } = req.params;
    
    const pool = (await import('../database/connection')).default;
    
    // Get import summary
    const importResult = await pool.query(
      `SELECT * FROM sap_data_imports WHERE id = $1`,
      [importId]
    );
    
    if (importResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { message: 'Import not found' }
      });
      return;
    }
    
    // Get all processed records for this import
    // Many columns may be null depending on source mapping, so we provide robust
    // fallbacks pulling from JSONB fields in both processed and raw data
    const recordsResult = await pool.query(
      `SELECT 
          spd.id,
          -- Display: Contract or PO
          COALESCE(
            spd.contract_number,
            spd.po_number,
            spd.data ->> 'contract_number',
            spd.data ->> 'Contract Number',
            spd.data ->> 'po_number',
            spd.data ->> 'PO Number',
            srd.data ->> 'Contract No.',
            srd.data ->> 'Contract Number',
            srd.data ->> 'PO No.',
            srd.data ->> 'PO Number'
          )                          AS display_contract_po,
          -- Display: Shipment or STO
          COALESCE(
            spd.shipment_id,
            spd.sto_number,
            spd.data ->> 'shipment_id',
            spd.data ->> 'Shipment ID',
            spd.data ->> 'sto_number',
            spd.data ->> 'STO Number',
            srd.data ->> 'Shipment ID',
            srd.data ->> 'STO No.'
          )                          AS display_shipment_sto,
          -- Supplier name
          COALESCE(
            spd.supplier_name,
            spd.data ->> 'supplier',
            spd.data ->> 'Supplier',
            srd.data ->> 'Supplier',
            srd.data ->> 'Supplier (vendor -> name 1))'
          )                          AS display_supplier_name,
          -- Product
          COALESCE(
            spd.product,
            spd.data ->> 'product',
            srd.data ->> 'Product',
            srd.data ->> 'material desc'
          )                          AS display_product,
          -- Vessel name
          COALESCE(
            spd.vessel_name,
            spd.data ->> 'vessel_name',
            srd.data ->> 'Vessel Name'
          )                          AS display_vessel_name,
          -- Row/status/error
          srd.row_number,
          srd.status                  AS record_status,
          srd.error_message,
          spd.created_at,
          spd.data   AS processed_data,
          srd.data   AS raw_data
       FROM sap_processed_data spd
       LEFT JOIN sap_raw_data srd ON srd.id = spd.raw_data_id
       WHERE spd.import_id = $1
       ORDER BY srd.row_number`,
      [importId]
    );

    // Compute processed/failed/skipped counts from raw_data statuses for accuracy
    const countsResult = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'processed') AS processed,
         COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')   AS skipped
       FROM sap_raw_data WHERE import_id = $1`,
      [importId]
    );
    
    res.json({
      success: true,
      data: {
        import: {
          ...importResult.rows[0],
          processed_records: countsResult.rows[0].processed,
          failed_records: countsResult.rows[0].failed,
          skipped_records: countsResult.rows[0].skipped
        },
        records: recordsResult.rows
      }
    });
    
  } catch (error) {
    logger.error('Failed to get import status', error);
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
};

/**
 * Get all imports
 */
export const getAllImports = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = (await import('../database/connection')).default;
    const result = await pool.query(
      `SELECT id, import_date, import_timestamp, status, total_records, 
              processed_records, failed_records 
       FROM sap_data_imports 
       ORDER BY import_timestamp DESC 
       LIMIT 50`
    );
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (error) {
    logger.error('Failed to get imports', error);
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
};

/**
 * Get pending data entries for a user role
 */
export const getPendingEntries = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Role-based filtering can be added later if needed
    // const { role } = _req.query;
    
    const pool = (await import('../database/connection')).default;
    
    // Get processed data that needs manual entry
    const result = await pool.query(
      `SELECT spd.id, spd.contract_number, spd.shipment_id, spd.supplier_name, 
              spd.product, spd.data, spd.created_at,
              COUNT(udi.id) as completed_fields
       FROM sap_processed_data spd
       LEFT JOIN user_data_inputs udi ON udi.processed_data_id = spd.id
       WHERE spd.created_at > CURRENT_DATE - INTERVAL '7 days'
       GROUP BY spd.id
       ORDER BY spd.created_at DESC
       LIMIT 100`
    );
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (error) {
    logger.error('Failed to get pending entries', error);
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
};

/**
 * Import SAP MASTER v2 data from uploaded file
 */
export const importMasterV2Upload = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { message: 'No file uploaded' },
      });
      return;
    }

    const filePath = req.file.path;
    logger.info('Queueing SAP MASTER v2 import from uploaded file', {
      fileName: req.file.originalname,
      filePath,
    });

    const queued = await SapMasterV2ImportService.queueMasterV2FileImport(filePath);

    res.status(202).json({
      success: true,
      data: {
        importId: queued.importId,
        totalRecords: queued.totalRecords,
        status: 'processing',
        message: `Import started for ${queued.totalRecords.toLocaleString()} records. Monitor progress in Import History.`,
      },
    });
  } catch (error) {
    logger.error('SAP MASTER v2 upload import failed', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: sapImportHttpError(error),
    });
  }
};

