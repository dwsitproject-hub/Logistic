import {
  parseDailyDeliverableQuantity,
  type NormalizedDailyDeliverableRow,
} from './truckingDailyDeliverables';
import { toIsoDate10FromCell } from './planningSheetDate';
import { isDateWithinUnplannedPlanningWindow } from './truckingUnplannedPlanningWindow';

export type ParsedUnplannedPlanningRow = {
  rowNumber: number;
  contract_ext_no: string;
  po_number: string;
  entries: Array<{ dateIso: string; qtyMt: number; lineNumber: number }>;
  /** Original spreadsheet cells for failed-row re-template export. */
  rawCells: unknown[];
};

export type UnplannedPlanningUploadFailure = {
  contract_ext_no: string;
  po_number?: string;
  rowNumbers: number[];
  reason: string;
  operation_ids?: string[];
};

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  }
  return String(value).trim();
}

function resolveWidePlanningTemplateQtyUnit(headerRow: unknown[]): 'kg' | 'mt' {
  for (const cell of headerRow) {
    const h = cellToString(cell).toLowerCase();
    // Explicit (kg) must win over bare "os qty" / "oq qty" labels.
    if (h.includes('(kg)')) return 'kg';
    if (h.includes('(mt)') || h.includes('os qty') || h.includes('oq qty')) return 'mt';
    if (h.includes('outstanding') && h.includes('mt')) return 'mt';
  }
  return 'mt';
}

function parseTemplateQtyToKg(raw: unknown, unit: 'kg' | 'mt'): number | null {
  const n = parseDailyDeliverableQuantity(raw);
  if (n === null || n < 0) return null;
  const kg = unit === 'mt' ? n * 1000 : n;
  return Math.round(kg * 100) / 100;
}

export function unplannedUploadCellToString(value: unknown): string {
  return cellToString(value);
}

function isWideTemplateMetadataHeader(header: string): boolean {
  const h = header.trim().toLowerCase();
  if (toIsoDate10FromCell(header)) return false;
  if (
    h === 'group' ||
    h === 'supplier' ||
    h === 'source' ||
    h === 'contract date' ||
    h === 'contract ext no' ||
    h === 'po' ||
    h === 'po number' ||
    h === 'status' ||
    h === 'os qty' ||
    h === 'os qty (kg)' ||
    h === 'os qty' ||
    h === 'os qty (mt)' ||
    h === 'oq qty' ||
    h === 'oq qty (mt)' ||
    h === 'plan qty' ||
    h === 'plan qty (kg)' ||
    h === 'plan qty (mt)' ||
    h === 'reason' ||
    h === 'failure reason' ||
    h.includes('outstanding')
  ) {
    return true;
  }
  return false;
}

function parseTemplateHeaderDateFromCell(raw: unknown): string | null {
  return toIsoDate10FromCell(raw);
}

function parseTemplateQtyKg(raw: unknown, unit: 'kg' | 'mt'): number | null {
  return parseTemplateQtyToKg(raw, unit);
}

function collectWideTemplateDateColumns(
  headerRow: unknown[],
): Array<{ colIndex: number; dateIso: string }> {
  const dateColumns: Array<{ colIndex: number; dateIso: string }> = [];
  for (let ci = 0; ci < headerRow.length; ci += 1) {
    const headerText = cellToString(headerRow[ci]);
    if (isWideTemplateMetadataHeader(headerText)) continue;
    const iso = parseTemplateHeaderDateFromCell(headerRow[ci]);
    if (iso) dateColumns.push({ colIndex: ci, dateIso: iso });
  }
  return dateColumns;
}

function resolveWideTemplateRowKeys(
  headerRow: unknown[],
  cells: unknown[],
): { contractExtNo: string; poNumber: string } {
  const headers = headerRow.map((h) => cellToString(h).toLowerCase());
  const extIdx = headers.findIndex((h) => h.includes('contract') && h.includes('ext'));
  const poIdx = headers.findIndex((h) => h === 'po' || h === 'po number');
  if (extIdx >= 0 || poIdx >= 0) {
    return {
      contractExtNo: extIdx >= 0 ? cellToString(cells[extIdx]) : '',
      poNumber: poIdx >= 0 ? cellToString(cells[poIdx]) : '',
    };
  }
  return {
    contractExtNo: cellToString(cells[0]),
    poNumber: cellToString(cells[1]),
  };
}

export function isUnplannedWidePlanningTemplateMatrix(matrix: unknown[][]): boolean {
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length < 3) return false;
  const headers = headerRow.map((cell) => cellToString(cell).toLowerCase());
  const hasGroup = headers.includes('group');
  const hasExt = headers.some((h) => h.includes('contract') && h.includes('ext'));
  const hasPo = headers.some((h) => h === 'po' || h === 'po number');
  const hasDateCols = collectWideTemplateDateColumns(headerRow).length > 0;
  if (hasGroup) {
    return hasExt && hasPo && hasDateCols;
  }
  const first = cellToString(headerRow[0]).toLowerCase();
  const second = cellToString(headerRow[1]).toLowerCase();
  return first.includes('contract') && first.includes('ext') && (second === 'po' || second === 'po number');
}

export function parseUnplannedWidePlanningMatrix(matrix: unknown[][]): {
  rows: ParsedUnplannedPlanningRow[];
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>;
} {
  const rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }> = [];
  const rows: ParsedUnplannedPlanningRow[] = [];

  if (matrix.length < 2) {
    return { rows, rowParseFailures };
  }

  const headerRow = matrix[0] ?? [];
  const qtyUnit = resolveWidePlanningTemplateQtyUnit(headerRow);
  const dateColumns = collectWideTemplateDateColumns(headerRow);
  if (dateColumns.length === 0) {
    rowParseFailures.push({
      rowNumber: 1,
      contract_ext_no: '-',
      reason: 'No date columns found in header row',
    });
    return { rows, rowParseFailures };
  }

  for (let rIdx = 1; rIdx < matrix.length; rIdx += 1) {
    const cells = matrix[rIdx] ?? [];
    const { contractExtNo, poNumber } = resolveWideTemplateRowKeys(headerRow, cells);
    const rowNumber = rIdx + 1;
    const hasAnyQty = dateColumns.some(({ colIndex }) => cellToString(cells[colIndex]) !== '');

    if (!contractExtNo && !poNumber && !hasAnyQty) continue;
    if (!contractExtNo && !poNumber) {
      rowParseFailures.push({
        rowNumber,
        contract_ext_no: '-',
        reason: 'Contract Ext No or PO is required',
      });
      continue;
    }

    const entries: ParsedUnplannedPlanningRow['entries'] = [];
    for (const { colIndex, dateIso } of dateColumns) {
      const qtyRaw = cells[colIndex];
      if (qtyRaw === undefined || qtyRaw === null || cellToString(qtyRaw) === '') continue;
      const qtyKg = parseTemplateQtyKg(qtyRaw, qtyUnit);
      if (qtyKg === null) {
        rowParseFailures.push({
          rowNumber,
          contract_ext_no: contractExtNo || poNumber || '-',
          reason: `Invalid quantity for date ${dateIso}`,
        });
        continue;
      }
      entries.push({ dateIso, qtyMt: qtyKg, lineNumber: rowNumber });
    }

    if (entries.length === 0 && hasAnyQty) {
      rowParseFailures.push({
        rowNumber,
        contract_ext_no: contractExtNo || poNumber || '-',
        reason: 'No valid planning quantities found in date columns',
      });
      continue;
    }
    if (entries.length === 0) continue;

    rows.push({
      rowNumber,
      contract_ext_no: contractExtNo,
      po_number: poNumber,
      entries,
      rawCells: [...cells],
    });
  }

  return { rows, rowParseFailures };
}

export function buildDailyDeliverablesFromKgEntries(
  entries: Array<{ dateIso: string; qtyMt: number }>,
): NormalizedDailyDeliverableRow[] {
  const byDate = new Map<string, number>();
  for (const entry of entries) {
    const kg = Math.round(entry.qtyMt * 100) / 100;
    byDate.set(entry.dateIso, kg);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, quantity_delivered]) => ({ date, quantity_delivered }));
}

/** @deprecated Values are already kg — use buildDailyDeliverablesFromKgEntries */
export function buildDailyDeliverablesKgFromMtEntries(
  entries: Array<{ dateIso: string; qtyMt: number }>,
): NormalizedDailyDeliverableRow[] {
  return buildDailyDeliverablesFromKgEntries(entries);
}

export function resolvePlanningStartEndFromDeliverables(
  daily: NormalizedDailyDeliverableRow[],
): { startIso: string; endIso: string } | null {
  if (daily.length === 0) return null;
  const dates = daily.map((d) => d.date).sort();
  return { startIso: dates[0], endIso: dates[dates.length - 1] };
}

export function filterEntriesLockedByActuals<T extends { dateIso: string; lineNumber: number }>(
  entries: T[],
  dailyActualsRaw: unknown,
  contractExtNo: string,
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>,
): T[] {
  const actualDates = new Set<string>();
  if (Array.isArray(dailyActualsRaw)) {
    for (const row of dailyActualsRaw) {
      const date = String((row as { date?: string; progress_date?: string })?.date ?? (row as { progress_date?: string })?.progress_date ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) actualDates.add(date);
    }
  }
  return entries.filter((entry) => {
    if (!actualDates.has(entry.dateIso)) return true;
    rowParseFailures.push({
      rowNumber: entry.lineNumber,
      contract_ext_no: contractExtNo,
      reason: `date ${entry.dateIso} is locked by WB actual and was skipped`,
    });
    return false;
  });
}

export function isWidePlanningTemplateMatrix(matrix: unknown[][]): boolean {
  return isUnplannedWidePlanningTemplateMatrix(matrix);
}

export function filterEntriesWithinUnplannedWindow<T extends { dateIso: string; lineNumber: number }>(
  entries: T[],
  _deliveryEndRaw: unknown,
  contractExtNo: string,
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>,
): T[] {
  return entries.filter((entry) => {
    const ok = isDateWithinUnplannedPlanningWindow(entry.dateIso);
    if (!ok) {
      rowParseFailures.push({
        rowNumber: entry.lineNumber,
        contract_ext_no: contractExtNo,
        reason: `date ${entry.dateIso} is outside allowed planning window (today … today + 60 days) and was skipped`,
      });
    }
    return ok;
  });
}
