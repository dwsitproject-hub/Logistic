import { Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { invalidateTruckingListCache } from '../services/truckingList.service';
import {
  deriveDbStatusFromRealization,
  listTruckingDailyActuals,
  replaceTruckingDailyActuals,
  resolveTruckingOperationByExtNoAndPo,
  upsertTruckingDailyActualRows,
  upsertTruckingRealization,
} from '../services/truckingRealization.service';
import {
  sqlRealizationEndDate,
  sqlRealizationStartDate,
  TRUCKING_REALIZATIONS_JOIN,
} from '../utils/truckingRealizationSql';
import { sqlSapTruckingLastReceiveDate, sqlSapTruckingStartReceiveDate } from '../utils/truckingSapDates';
import { assertTruckingOperationContractOpen } from '../utils/contractDeliveryStatus';
import { buildTruckingPageListScopeSql } from '../utils/truckingIncotermScope';
import {
  parsePlanningSheetToMatrix,
  parseWbRekapWorkbookSheetsFromBuffer,
  toIsoDate10FromCell,
} from '../utils/planningSheetDate';
import { processWbRekapWorkbookUpload } from '../services/truckingWbImport.service';

const MAX_BULK_ACTUALS_ROWS = 20000;

function findPlanningColumnIndex(headers: unknown[], candidates: string[]): number {
  const normalized = headers.map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' '),
  );
  for (const candidate of candidates) {
    const c = candidate.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const idx = normalized.findIndex((h) => h === c || h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Quantities in list-tab actuals template are MT/day; store as kg in daily_actuals. */
function parseActualsTemplateQtyMtToKg(qtyRaw: unknown): number | null {
  const n = Number(String(qtyRaw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000 * 100) / 100;
}

function parseActualsQtyKg(qtyRaw: unknown): number | null {
  const n = Number(String(qtyRaw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseIsoDateInput(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export const getTruckingRealization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT
         t.id,
         t.trucking_start_date AS planning_start_date,
         t.trucking_completion_date AS planning_end_date,
         tr.realization_start_date,
         tr.realization_end_date,
         tr.source AS realization_source,
         ${sqlSapTruckingStartReceiveDate('c')} AS sap_realization_start_date,
         ${sqlSapTruckingLastReceiveDate('c')} AS sap_realization_end_date,
         ${sqlRealizationStartDate('c')} AS effective_realization_start_date,
         ${sqlRealizationEndDate('c')} AS effective_realization_end_date
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       ${TRUCKING_REALIZATIONS_JOIN}
       WHERE t.id = $1
       LIMIT 1`,
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
    }
    const row = result.rows[0];
    const dailyActuals = await listTruckingDailyActuals(id);
    return res.json({
      success: true,
      data: {
        ...row,
        daily_actuals: dailyActuals.map((a) => ({
          date: a.progress_date,
          progress_date: a.progress_date,
          quantity_kg: a.quantity_kg,
          quantity_delivered: a.quantity_kg,
          quantity_delivery_kg:
            a.quantity_delivery_kg != null ? a.quantity_delivery_kg : a.quantity_kg,
          quantity_receive_kg: a.quantity_receive_kg,
        })),
      },
    });
  } catch (err) {
    logger.error('getTruckingRealization error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load realization data' } });
  }
};

export const updateTruckingRealization = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const start = parseIsoDateInput(req.body?.realization_start_date);
    const end = parseIsoDateInput(req.body?.realization_end_date);

    const exists = await query(`SELECT id, status FROM trucking_operations WHERE id = $1 LIMIT 1`, [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
    }

    const contractOpen = await assertTruckingOperationContractOpen(id);
    if (!contractOpen.ok) {
      return res.status(403).json({ success: false, error: { message: contractOpen.message } });
    }

    if (start && end && end < start) {
      return res.status(400).json({
        success: false,
        error: { message: 'Realization end date cannot be before start date' },
      });
    }

    const saved = await upsertTruckingRealization(query, id, {
      realizationStartDate: start,
      realizationEndDate: end,
      source: 'manual',
      userId: req.user?.id ?? null,
    });

    const nextStatus = deriveDbStatusFromRealization(
      exists.rows[0].status,
      saved.realization_start_date,
      saved.realization_end_date,
    );
    await query(
      `UPDATE trucking_operations SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, nextStatus],
    );

    invalidateTruckingListCache();
    return res.json({
      success: true,
      message: 'Trucking realization updated',
      data: saved,
    });
  } catch (err) {
    logger.error('updateTruckingRealization error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to update realization' } });
  }
};

export const updateTruckingDailyActuals = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const rows = Array.isArray(req.body?.daily_actuals) ? req.body.daily_actuals : [];

    const exists = await query(`SELECT id FROM trucking_operations WHERE id = $1 LIMIT 1`, [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
    }

    const contractOpen = await assertTruckingOperationContractOpen(id);
    if (!contractOpen.ok) {
      return res.status(403).json({ success: false, error: { message: contractOpen.message } });
    }

    const normalized = rows
      .map((r: { date?: string; progress_date?: string; quantity_kg?: number; quantity_delivered?: number }) => ({
        progress_date: String(r.progress_date || r.date || '').trim().slice(0, 10),
        quantity_kg: Number(r.quantity_kg ?? r.quantity_delivered ?? 0),
      }))
      .filter((r: { progress_date: string; quantity_kg: number }) =>
        r.progress_date && Number.isFinite(r.quantity_kg) && r.quantity_kg >= 0
      );

    if (req.body?.replace === true) {
      await replaceTruckingDailyActuals(query, id, normalized, 'manual');
    } else {
      await upsertTruckingDailyActualRows(query, id, normalized, 'manual');
    }

    invalidateTruckingListCache();
    const dailyActuals = await listTruckingDailyActuals(id);
    return res.json({
      success: true,
      message: 'Daily actual quantities updated',
      data: { daily_actuals: dailyActuals },
    });
  } catch (err) {
    logger.error('updateTruckingDailyActuals error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to update daily actuals' } });
  }
};

export const downloadDailyActualsTemplate = async (_req: AuthRequest, res: Response) => {
  const header = 'contract_ext_no,date,quantity_delivered';
  const example = 'EXT-12345,15/04/2026,1000';
  const bom = '\ufeff';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="trucking-daily-actuals-template.csv"');
  return res.send(`${bom}${header}\n${example}\n`);
};

export const bulkUploadDailyActuals = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        error: { message: e?.message || 'Could not read spreadsheet' },
      });
    }

    if (matrix.length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'File must include a header row and at least one data row' },
      });
    }

    const headerRow = matrix[0];
    const extIdx = findPlanningColumnIndex(headerRow, [
      'contract_ext_no',
      'contract ext no',
      'contractextno',
      'contract ext',
      'ext no',
    ]);
    const poIdx = findPlanningColumnIndex(headerRow, ['po', 'po number', 'po_number']);
    const dateIdx = findPlanningColumnIndex(headerRow, ['date', 'tanggal']);
    const qtyIdx = findPlanningColumnIndex(headerRow, [
      'quantity_delivered',
      'quantity delivered',
      'quantity',
      'qty',
      'qty_delivered',
    ]);

    const secondColRaw = headerRow[1];
    const secondColStr = String(secondColRaw ?? '').trim().toLowerCase();
    const isWideWithPo =
      poIdx === 1 ||
      secondColStr === 'po' ||
      secondColStr === 'po number';
    const isWideFormat =
      isWideWithPo ||
      (secondColStr !== 'date' &&
        secondColStr !== 'tanggal' &&
        secondColStr !== 'qty' &&
        secondColStr !== 'qty delivery' &&
        toIsoDate10FromCell(secondColRaw) !== null);

    type ParsedLine = {
      lineNumber: number;
      contract_ext_no: string;
      po_number: string;
      dateRaw: unknown;
      qtyRaw: unknown;
      qtyIsMt: boolean;
    };
    const lines: ParsedLine[] = [];
    const rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[] = [];

    if (isWideFormat) {
      const dateColumns: { colIdx: number; dateRaw: unknown }[] = [];
      const startCol = isWideWithPo ? 2 : 1;
      for (let ci = startCol; ci < headerRow.length; ci++) {
        const cellVal = headerRow[ci];
        if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '') {
          dateColumns.push({ colIdx: ci, dateRaw: cellVal });
        }
      }

      if (dateColumns.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Wide format detected but no date columns found in header row' },
        });
      }

      for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
        const row = matrix[rIdx];
        const ext = String(row[extIdx >= 0 ? extIdx : 0] ?? '').trim();
        const po = poIdx >= 0 ? String(row[poIdx] ?? '').trim() : '';
        const hasAnyQty = dateColumns.some(({ colIdx }) => {
          const v = row[colIdx];
          return v !== undefined && v !== null && String(v).trim() !== '';
        });
        if (!ext && !po && !hasAnyQty) continue;

        const lineNumber = rIdx + 1;
        if (!ext && !po) {
          rowParseFailures.push({
            rowNumber: lineNumber,
            contract_ext_no: '-',
            reason: 'Contract Ext No or PO is required',
          });
          continue;
        }

        let rowLimitHit = false;
        for (const { colIdx, dateRaw } of dateColumns) {
          const qtyCell = row[colIdx];
          if (qtyCell === undefined || qtyCell === null || String(qtyCell).trim() === '') continue;
          if (lines.length >= MAX_BULK_ACTUALS_ROWS) {
            rowParseFailures.push({
              rowNumber: lineNumber,
              contract_ext_no: ext,
              reason: `Exceeds max ${MAX_BULK_ACTUALS_ROWS} rows`,
            });
            rowLimitHit = true;
            break;
          }
          lines.push({
            lineNumber,
            contract_ext_no: ext,
            po_number: po,
            dateRaw,
            qtyRaw: qtyCell,
            qtyIsMt: isWideWithPo,
          });
        }
        if (rowLimitHit) break;
      }
    } else {
      if (extIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
        return res.status(400).json({
          success: false,
          error: {
            message:
              'Missing required columns. Expected: contract_ext_no, date, quantity_delivered (or wide format with date columns)',
          },
        });
      }

      for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
        const row = matrix[rIdx];
        const ext = String(row[extIdx] ?? '').trim();
        const dateRaw = row[dateIdx];
        const qtyCell = row[qtyIdx];
        const po = poIdx >= 0 ? String(row[poIdx] ?? '').trim() : '';

        const emptyRow =
          !ext &&
          !po &&
          (dateRaw === undefined || dateRaw === null || String(dateRaw).trim() === '') &&
          (qtyCell === undefined || qtyCell === null || String(qtyCell).trim() === '');
        if (emptyRow) continue;

        const lineNumber = rIdx + 1;
        if (lines.length >= MAX_BULK_ACTUALS_ROWS) {
          rowParseFailures.push({
            rowNumber: lineNumber,
            contract_ext_no: ext || po || '-',
            reason: `Exceeds max ${MAX_BULK_ACTUALS_ROWS} rows`,
          });
          break;
        }
        if (!ext && !po) {
          rowParseFailures.push({
            rowNumber: lineNumber,
            contract_ext_no: '-',
            reason: 'Contract Ext No or PO is required',
          });
          continue;
        }
        lines.push({
          lineNumber,
          contract_ext_no: ext,
          po_number: po,
          dateRaw: dateRaw ?? '',
          qtyRaw: qtyCell,
          qtyIsMt: false,
        });
      }
    }

    const byOperationKey = new Map<string, ParsedLine[]>();
    for (const ln of lines) {
      const k = `${ln.contract_ext_no.trim().toLowerCase()}::${ln.po_number.trim().toLowerCase()}`;
      const list = byOperationKey.get(k) || [];
      list.push(ln);
      byOperationKey.set(k, list);
    }

    const operationFailures: {
      contract_ext_no: string;
      rowNumbers: number[];
      reason: string;
    }[] = [];
    let operationsUpdated = 0;
    let rowsSucceeded = 0;

    for (const [, groupLines] of byOperationKey) {
      const contractExtNo = groupLines[0].contract_ext_no;
      const poNumber = groupLines[0].po_number;
      const rowNumbers = groupLines.map((l) => l.lineNumber);

      const resolved = await resolveTruckingOperationByExtNoAndPo(query, contractExtNo, poNumber);
      if (!resolved.ok) {
        operationFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: resolved.message,
        });
        continue;
      }
      const operationId = resolved.operationId;

      const contractOpen = await assertTruckingOperationContractOpen(operationId);
      if (!contractOpen.ok) {
        operationFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: contractOpen.message || 'Contract is closed for editing',
        });
        continue;
      }

      const actualRows: { progress_date: string; quantity_kg: number }[] = [];
      let groupFailed = false;

      for (const ln of groupLines) {
        const iso = toIsoDate10FromCell(ln.dateRaw);
        if (!iso) {
          rowParseFailures.push({
            rowNumber: ln.lineNumber,
            contract_ext_no: contractExtNo,
            reason: 'date is missing or could not be parsed (use DD/MM/YYYY or Excel date)',
          });
          groupFailed = true;
          continue;
        }
        const qtyKg = ln.qtyIsMt
          ? parseActualsTemplateQtyMtToKg(ln.qtyRaw)
          : parseActualsQtyKg(ln.qtyRaw);
        if (qtyKg === null) {
          rowParseFailures.push({
            rowNumber: ln.lineNumber,
            contract_ext_no: contractExtNo,
            reason: 'quantity is missing or invalid',
          });
          groupFailed = true;
          continue;
        }
        actualRows.push({ progress_date: iso, quantity_kg: qtyKg });
      }

      if (groupFailed || actualRows.length === 0) {
        if (actualRows.length === 0 && !groupFailed) {
          operationFailures.push({
            contract_ext_no: contractExtNo,
            rowNumbers,
            reason: 'No valid quantity rows for this contract',
          });
        }
        continue;
      }

      await upsertTruckingDailyActualRows(query, operationId, actualRows, 'csv');
      operationsUpdated += 1;
      rowsSucceeded += actualRows.length;
    }

    invalidateTruckingListCache();
    return res.json({
      success: true,
      message: `Daily actuals updated for ${operationsUpdated} operation(s)`,
      data: {
        contractsUpdated: operationsUpdated,
        operationsUpdated,
        succeededRows: rowsSucceeded,
        processedRows: lines.length,
        rowParseFailures,
        operationFailures,
      },
    });
  } catch (err) {
    logger.error('bulkUploadDailyActuals error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to bulk upload daily actuals' } });
  }
};

export const getTruckingDailyActualsCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'from and to query params are required' } });
    }

    const result = await query(
      `SELECT
         t.id,
         t.operation_id,
         c.contract_id AS contract_number,
         COALESCE(spd.contract_ext_no, c.contract_id) AS contract_ext_no,
         c.sto_number,
         c.supplier,
         c.product,
         t.daily_deliverables,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object('date', da.progress_date::text, 'quantity_delivered', da.quantity_kg)
               ORDER BY da.progress_date
             )
             FROM trucking_daily_actuals da
             WHERE da.trucking_operation_id = t.id
           ),
           '[]'::jsonb
         ) AS daily_actuals
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) spd ON true
       WHERE ${buildTruckingPageListScopeSql()}
         AND EXISTS (
           SELECT 1 FROM trucking_daily_actuals da
           WHERE da.trucking_operation_id = t.id
             AND da.progress_date BETWEEN $1::date AND $2::date
         )
       ORDER BY c.contract_id ASC`,
      [from, to],
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getTruckingDailyActualsCalendar error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load daily actuals calendar' } });
  }
};

/** Upload WB rekap Excel — aggregate Netto PKS/EUP per PO + Tanggal Masuk into trucking_daily_actuals. */
export const bulkUploadWbRekap = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (Excel .xlsx/.xls)' } });
    }

    const filename = String(file.originalname ?? '').trim();
    if (!/\.(xlsx|xls)$/i.test(filename)) {
      return res.status(400).json({
        success: false,
        error: { message: 'WB upload requires an Excel file (.xlsx or .xls)' },
      });
    }

    let sheets;
    try {
      sheets = parseWbRekapWorkbookSheetsFromBuffer(file.buffer);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not read workbook';
      return res.status(400).json({ success: false, error: { message } });
    }

    if (sheets.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'Workbook has no worksheets' } });
    }

    const result = await processWbRekapWorkbookUpload({
      originalFilename: filename,
      uploadedBy: req.user?.id ?? null,
      sheets,
    });

    invalidateTruckingListCache();

    return res.json({
      success: true,
      message: `WB rekap processed — ${result.rowsUpserted} daily actual row(s) upserted across ${result.operationsUpdated} operation(s)`,
      data: {
        importId: result.importId,
        status: result.status,
        sheetsProcessed: result.sheetsProcessed,
        sheetsSkipped: result.sheetsSkipped,
        rawTicketRows: result.rawTicketRows,
        aggregatedPoDates: result.aggregatedPoDates,
        operationsUpdated: result.operationsUpdated,
        operationsFailed: result.operationsFailed,
        rowsUpserted: result.rowsUpserted,
        rowParseFailures: result.rowParseFailures,
        operationFailures: result.operationFailures,
        operationWarnings: result.operationWarnings,
        operationDeduped: result.operationDeduped,
      },
    });
  } catch (err) {
    logger.error('bulkUploadWbRekap error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to process WB rekap upload' } });
  }
};
