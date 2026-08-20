import { Request, Response } from 'express';
import { SapMasterV2ImportService } from '../services/sapMasterV2Import.service';
import logger from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import { SQL_ACTIVE_SAP_IMPORT } from '../utils/sapImportInFlightSql';

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

    // Compute processed/failed/skipped counts from raw_data statuses for accuracy.
    // NOTE: while status is 'processing'/'pending', these sap_raw_data rows live inside
    // the still-open import transaction on a different connection and are invisible here
    // until it commits — so this recount would stubbornly read 0 for the whole import and
    // make it look hung. Use the live `sap_data_imports.processed_records`/`failed_records`
    // columns instead in that case (updated every 25 rows via an independent connection —
    // see maybeRefreshImportProgress in sapMasterV2Import.service.ts). Once the import
    // reaches a terminal status both sources agree, so the raw-data recount is kept there
    // as an accuracy check.
    const importRow = importResult.rows[0];
    const isInFlight = importRow.status === 'processing' || importRow.status === 'pending';

    let processedRecords = Number(importRow.processed_records) || 0;
    let failedRecords = Number(importRow.failed_records) || 0;
    let skippedRecords = 0;

    if (!isInFlight) {
      const countsResult = await pool.query(
        `SELECT 
           COUNT(*) FILTER (WHERE status = 'processed') AS processed,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) FILTER (WHERE status = 'skipped')   AS skipped
         FROM sap_raw_data WHERE import_id = $1`,
        [importId]
      );
      processedRecords = Number(countsResult.rows[0].processed) || 0;
      failedRecords = Number(countsResult.rows[0].failed) || 0;
      skippedRecords = Number(countsResult.rows[0].skipped) || 0;
    }

    res.json({
      success: true,
      data: {
        import: {
          ...importRow,
          processed_records: processedRecords,
          failed_records: failedRecords,
          skipped_records: skippedRecords
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
 * Lightweight in-flight import status for any authenticated user (trucking uploads, global banner).
 */
export const getActiveImport = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = (await import('../database/connection')).default;
    const result = await pool.query(SQL_ACTIVE_SAP_IMPORT);
    const row = result.rows[0] ?? null;
    res.json({
      success: true,
      data: {
        active: row != null,
        import: row,
      },
    });
  } catch (error) {
    logger.error('Failed to get active SAP import', error);
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
};

/**
 * Get all imports
 */
export const getAllImports = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = (await import('../database/connection')).default;

    // Mark imports stuck after server restart (processing but no rows ever written).
    await pool.query(
      `UPDATE sap_data_imports
       SET status = 'failed',
           error_log = COALESCE(error_log, $1)
       WHERE status IN ('processing', 'pending')
         AND import_timestamp < NOW() - INTERVAL '30 minutes'
         AND NOT EXISTS (SELECT 1 FROM sap_raw_data srd WHERE srd.import_id = sap_data_imports.id)`,
      [JSON.stringify(['Import interrupted — no rows were processed. Please upload the file again.'])],
    );

    // While an import is still running, its `sap_raw_data` inserts live inside the same
    // long-lived transaction and are invisible to this (separate) connection until the
    // final COMMIT — recomputing counts from sap_raw_data here would show 0% the entire
    // time and make the import look hung. `sap_data_imports.processed_records`/
    // `failed_records` are instead updated every 25 rows via an independent connection
    // (see maybeRefreshImportProgress in sapMasterV2Import.service.ts), so they ARE live.
    // For finished imports both sources agree, so we keep the raw-data recount there for
    // an extra accuracy check.
    const result = await pool.query(
      `SELECT
         i.id,
         i.import_date,
         i.import_timestamp,
         i.status,
         i.total_records,
         CASE WHEN i.status IN ('processing', 'pending')
           THEN COALESCE(i.processed_records, 0)
           ELSE COALESCE(rc.processed, 0)
         END::int AS processed_records,
         CASE WHEN i.status IN ('processing', 'pending')
           THEN COALESCE(i.failed_records, 0)
           ELSE COALESCE(rc.failed, 0)
         END::int AS failed_records
       FROM sap_data_imports i
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('processed', 'skipped')) AS processed,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
         FROM sap_raw_data
         WHERE import_id = i.id
       ) rc ON TRUE
       ORDER BY i.import_timestamp DESC
       LIMIT 50`,
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

