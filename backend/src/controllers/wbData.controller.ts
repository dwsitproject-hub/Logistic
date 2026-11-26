import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

/*
 * WB Data: the history of the weighbridge (WB rekap) uploads made on the Trucking page.
 * Read-only. Everything comes from trucking_wb_imports (one row per upload, written by processWbRekapWorkbookUpload) and from trucking_daily_actuals.wb_import_id.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The newest uploads the page lists. The table holds about 60 a month; this keeps the answer small whatever it grows to. */
const LIST_LIMIT = 200;
/** Rows of "what this upload wrote" sent with the detail. The total is sent as well, so the page can say it is a part. */
const DETAIL_ROWS_LIMIT = 500;

const arrayLen = (col: string) => `CASE WHEN jsonb_typeof(${col}) = 'array' THEN jsonb_array_length(${col}) ELSE 0 END`;

export const listWbImports = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT i.id,
              i.original_filename AS file_name,
              i.status,
              i.created_at,
              i.updated_at,
              i.uploaded_by,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS uploaded_by_name,
              u.username AS uploaded_by_username,
              i.raw_ticket_rows,
              i.aggregated_po_dates,
              i.operations_updated,
              i.operations_failed,
              i.rows_upserted,
              ${arrayLen('i.sheets_processed')} AS sheets_processed_count,
              ${arrayLen('i.sheets_skipped')} AS sheets_skipped_count,
              ${arrayLen('i.row_parse_failures')} AS parse_failures_count
         FROM trucking_wb_imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
        ORDER BY i.created_at DESC
        LIMIT ${LIST_LIMIT}`,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List WB imports failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load WB upload history' } });
  }
};

export const getWbImport = async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid upload id' } });
    }

    const head = await query(
      `SELECT i.id,
              i.original_filename AS file_name,
              i.status,
              i.created_at,
              i.updated_at,
              i.uploaded_by,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS uploaded_by_name,
              u.username AS uploaded_by_username,
              i.raw_ticket_rows,
              i.aggregated_po_dates,
              i.operations_updated,
              i.operations_failed,
              i.rows_upserted,
              i.sheets_processed,
              i.sheets_skipped,
              i.row_parse_failures,
              i.operation_failures
         FROM trucking_wb_imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
        WHERE i.id = $1::uuid`,
      [id],
    );
    if (head.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Upload not found' } });
    }

    // A re-upload of the same PO and date takes the row over (wb_import_id is replaced), so this is what the upload STILL holds, not everything it ever wrote.
    const [rows, total] = await Promise.all([
      query(
        `SELECT da.progress_date::text AS progress_date,
                NULLIF(TRIM(da.sto_number::text), '') AS sto_number,
                da.quantity_kg,
                da.quantity_delivery_kg,
                da.quantity_receive_kg,
                da.first_time_in::text AS first_time_in,
                da.last_time_out::text AS last_time_out,
                c.po_number,
                c.contract_id AS contract_number,
                t.operation_id AS operation_id
           FROM trucking_daily_actuals da
           LEFT JOIN trucking_operations t ON t.id = da.trucking_operation_id
           LEFT JOIN contracts c ON c.id = t.contract_id
          WHERE da.wb_import_id = $1::uuid
          ORDER BY da.progress_date DESC, c.po_number, t.operation_id, da.sto_number
          LIMIT ${DETAIL_ROWS_LIMIT}`,
        [id],
      ),
      query(`SELECT COUNT(*)::int AS n FROM trucking_daily_actuals WHERE wb_import_id = $1::uuid`, [id]),
    ]);

    return res.json({
      success: true,
      data: { import: head.rows[0], rows: rows.rows, rowsTotal: total.rows[0]?.n ?? 0 },
    });
  } catch (error) {
    logger.error('Get WB import failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load the WB upload' } });
  }
};
