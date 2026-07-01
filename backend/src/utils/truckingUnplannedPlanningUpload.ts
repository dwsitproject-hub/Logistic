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

function isWideTemplateMetadataHeader(header: string): boolean {
  return header.trim().toLowerCase().includes('outstanding');
}

function parseTemplateHeaderDateFromCell(raw: unknown): string | null {
  return toIsoDate10FromCell(raw);
}

function parseTemplateQtyMt(raw: unknown): number | null {
  const n = parseDailyDeliverableQuantity(raw);
  if (n === null || n < 0) return null;
  return n;
}

function collectWideTemplateDateColumns(
  headerRow: unknown[],
): Array<{ colIndex: number; dateIso: string }> {
  const dateColumns: Array<{ colIndex: number; dateIso: string }> = [];
  for (let ci = 2; ci < headerRow.length; ci += 1) {
    const headerText = cellToString(headerRow[ci]);
    if (isWideTemplateMetadataHeader(headerText)) continue;
    const iso = parseTemplateHeaderDateFromCell(headerRow[ci]);
    if (iso) dateColumns.push({ colIndex: ci, dateIso: iso });
  }
  return dateColumns;
}

export function isUnplannedWidePlanningTemplateMatrix(matrix: unknown[][]): boolean {
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length < 3) return false;
  const first = cellToString(headerRow[0]).toLowerCase();
  const second = cellToString(headerRow[1]).toLowerCase();
  const hasExt = first.includes('contract') && first.includes('ext');
  const hasPo = second === 'po' || second === 'po number';
  return hasExt && hasPo;
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
    const contractExtNo = cellToString(cells[0]);
    const poNumber = cellToString(cells[1]);
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
      const qtyMt = parseTemplateQtyMt(qtyRaw);
      if (qtyMt === null) {
        rowParseFailures.push({
          rowNumber,
          contract_ext_no: contractExtNo || poNumber || '-',
          reason: `Invalid quantity for date ${dateIso}`,
        });
        continue;
      }
      entries.push({ dateIso, qtyMt, lineNumber: rowNumber });
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
    });
  }

  return { rows, rowParseFailures };
}

export function buildDailyDeliverablesKgFromMtEntries(
  entries: Array<{ dateIso: string; qtyMt: number }>,
): NormalizedDailyDeliverableRow[] {
  const byDate = new Map<string, number>();
  for (const entry of entries) {
    const kg = Math.round(entry.qtyMt * 1000 * 100) / 100;
    byDate.set(entry.dateIso, kg);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, quantity_delivered]) => ({ date, quantity_delivered }));
}

export function resolvePlanningStartEndFromDeliverables(
  daily: NormalizedDailyDeliverableRow[],
): { startIso: string; endIso: string } | null {
  if (daily.length === 0) return null;
  const dates = daily.map((d) => d.date).sort();
  return { startIso: dates[0], endIso: dates[dates.length - 1] };
}

export function filterEntriesWithinUnplannedWindow<T extends { dateIso: string; lineNumber: number }>(
  entries: T[],
  deliveryEndRaw: unknown,
  contractExtNo: string,
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>,
): T[] {
  return entries.filter((entry) => {
    const ok = isDateWithinUnplannedPlanningWindow(entry.dateIso, deliveryEndRaw);
    if (!ok) {
      rowParseFailures.push({
        rowNumber: entry.lineNumber,
        contract_ext_no: contractExtNo,
        reason: `date ${entry.dateIso} is outside allowed Unplanned planning window and was skipped`,
      });
    }
    return ok;
  });
}
