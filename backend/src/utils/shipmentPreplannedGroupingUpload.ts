/**
 * Shipments Unplanned → Preplanned grouping Excel parse + workbook builder (Wave 1).
 * Mirrors frontend/src/lib/shipmentGroupingTemplate.ts — keep columns/rules in sync.
 */

import * as XLSX from 'xlsx';
import type { GroupingTemplateDbRow } from './shipmentPreplannedGroupingTemplateSql';

export const SHIPMENT_GROUPING_INSTRUCTION =
  'Isi Y pada PO yang ikut batch ini. Isi Group dengan kode yang sama untuk PO yang akan satu kapal (contoh 1 atau A). Bukan nama vessel — vessel dan ETA diisi nanti saat Planned. Baris tanpa Y tidak di-upload.';

export const SHIPMENT_GROUPING_SHEET_NAME = 'Grouping';
export const SHIPMENT_GROUPING_HELP_SHEET_NAME = 'Cara isi';

export const SHIPMENT_GROUPING_TEMPLATE_HEADERS = [
  'Select',
  'Group',
  'Supplier',
  'Region/Plant',
  'Product',
  'Incoterm',
  'Buyer',
  'PO Number',
  'Contract Date',
  'Contract Qty (MT)',
  'OS Qty (MT)',
  'Status',
] as const;

export type ParsedShipmentGroupingRow = {
  excelRowNumber: number;
  selectY: boolean;
  group: string;
  poNumber: string;
  supplier: string;
};

export type ShipmentGroupingParseIssue = {
  excelRowNumber: number;
  reason: string;
};

export type ShipmentGroupingParseResult = {
  headerRowIndex: number;
  selectedRows: ParsedShipmentGroupingRow[];
  skippedWithoutY: number;
  issues: ShipmentGroupingParseIssue[];
};

export function isSelectY(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'Y';
}

export function normalizeGroupingMatchKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function formatGroupingQtyMtFromKg(kg: unknown): string {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = typeof kg === 'string' ? Number(String(kg).replace(/,/g, '')) : Number(kg);
  if (!Number.isFinite(n)) return '';
  return (n / 1000).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(value).trim();
}

function sliceIsoDate(value: unknown): string {
  const raw = cellText(value);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1]!;
  return raw;
}

function headerKey(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isShipmentGroupingTemplateHeaderRow(cells: unknown[]): boolean {
  const keys = cells.map(headerKey);
  const hasSelect = keys.some((k) => k === 'select');
  const hasGroup = keys.some((k) => k === 'group');
  const hasPo = keys.some(
    (k) => k === 'po number' || k === 'po' || k === 'po no' || k === 'po_number',
  );
  return hasSelect && hasGroup && hasPo;
}

function colIndex(headerRow: unknown[], aliases: string[]): number {
  const wanted = aliases.map((a) => a.toLowerCase());
  return headerRow.findIndex((cell) => wanted.includes(headerKey(cell)));
}

export function parseShipmentGroupingMatrix(matrix: unknown[][]): ShipmentGroupingParseResult {
  const headerRowIndex = matrix.findIndex((row) => isShipmentGroupingTemplateHeaderRow(row ?? []));
  if (headerRowIndex < 0) {
    return {
      headerRowIndex: -1,
      selectedRows: [],
      skippedWithoutY: 0,
      issues: [{ excelRowNumber: 1, reason: 'Header row not found (need Select, Group, PO Number)' }],
    };
  }
  const header = matrix[headerRowIndex] ?? [];
  const selectIdx = colIndex(header, ['select']);
  const groupIdx = colIndex(header, ['group']);
  const poIdx = colIndex(header, ['po number', 'po', 'po no', 'po_number']);
  const supplierIdx = colIndex(header, ['supplier']);

  const selectedRows: ParsedShipmentGroupingRow[] = [];
  const issues: ShipmentGroupingParseIssue[] = [];
  let skippedWithoutY = 0;

  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const excelRowNumber = i + 1;
    const group = cellText(row[groupIdx]);
    const poNumber = cellText(row[poIdx]);
    const supplier = supplierIdx >= 0 ? cellText(row[supplierIdx]) : '';
    if (!isSelectY(row[selectIdx])) {
      skippedWithoutY += 1;
      continue;
    }
    if (!group) {
      issues.push({ excelRowNumber, reason: 'isi Group' });
      continue;
    }
    if (!poNumber) {
      issues.push({ excelRowNumber, reason: 'PO Number is required' });
      continue;
    }
    selectedRows.push({
      excelRowNumber,
      selectY: true,
      group,
      poNumber,
      supplier,
    });
  }

  return { headerRowIndex, selectedRows, skippedWithoutY, issues };
}

export type ShipmentGroupingCluster = {
  group: string;
  rows: ParsedShipmentGroupingRow[];
};

export function clusterShipmentGroupingRowsByGroup(
  rows: ParsedShipmentGroupingRow[],
): ShipmentGroupingCluster[] {
  const order: string[] = [];
  const byGroup = new Map<string, ParsedShipmentGroupingRow[]>();
  for (const row of rows) {
    const key = row.group.trim();
    if (!byGroup.has(key)) {
      order.push(key);
      byGroup.set(key, []);
    }
    byGroup.get(key)!.push(row);
  }
  return order.map((group) => ({ group, rows: byGroup.get(group)! }));
}

export type EligibleGroupingIdentity = {
  id: string;
  poNumber: string;
};

export type GroupingRowMatch =
  | { ok: true; contractId: string; row: ParsedShipmentGroupingRow }
  | { ok: false; row: ParsedShipmentGroupingRow; reason: string };

export function matchGroupingRowsToContracts(
  rows: ParsedShipmentGroupingRow[],
  eligible: EligibleGroupingIdentity[],
): GroupingRowMatch[] {
  const byPo = new Map<string, EligibleGroupingIdentity>();
  for (const row of eligible) {
    const poKey = normalizeGroupingMatchKey(row.poNumber);
    if (poKey && !byPo.has(poKey)) byPo.set(poKey, row);
  }

  const usedIds = new Map<string, string>();
  return rows.map((row) => {
    const poKey = normalizeGroupingMatchKey(row.poNumber);
    const hit = poKey ? byPo.get(poKey) : undefined;
    if (!hit) {
      return {
        ok: false as const,
        row,
        reason: 'PO not eligible (already shipped, closed, or already Preplanned)',
      };
    }
    const priorGroup = usedIds.get(hit.id);
    if (priorGroup && priorGroup !== row.group.trim()) {
      return {
        ok: false as const,
        row,
        reason: `PO already assigned to Group ${priorGroup}`,
      };
    }
    usedIds.set(hit.id, row.group.trim());
    return { ok: true as const, contractId: hit.id, row };
  });
}

function groupingTemplateSourceFromDb(row: GroupingTemplateDbRow): {
  supplier: string;
  plantSite: string;
  product: string;
  incoterm: string;
  buyer: string;
  poNumber: string;
  contractDate: string;
  contractQtyKg: number;
  outstandingQtyKg: number;
} {
  return {
    supplier: cellText(row.supplier),
    plantSite: cellText(row.plant_site),
    product: cellText(row.product),
    incoterm: cellText(row.incoterm),
    buyer: cellText(row.buyer),
    poNumber: cellText(row.po_number),
    contractDate: sliceIsoDate(row.contract_date),
    contractQtyKg: Number(row.contract_qty_kg ?? 0),
    outstandingQtyKg: Number(row.outstanding_qty_kg ?? 0),
  };
}

export function buildShipmentGroupingTemplateMatrixFromDb(
  rows: GroupingTemplateDbRow[],
): (string | number)[][] {
  const matrix: (string | number)[][] = [
    [SHIPMENT_GROUPING_INSTRUCTION],
    [...SHIPMENT_GROUPING_TEMPLATE_HEADERS],
  ];
  for (const raw of rows) {
    const row = groupingTemplateSourceFromDb(raw);
    matrix.push([
      '',
      '',
      row.supplier,
      row.plantSite,
      row.product,
      row.incoterm,
      row.buyer,
      row.poNumber,
      row.contractDate,
      formatGroupingQtyMtFromKg(row.contractQtyKg),
      formatGroupingQtyMtFromKg(row.outstandingQtyKg),
      'Unplanned',
    ]);
  }
  return matrix;
}

const GROUPING_COL_WIDTHS = [10, 16, 28, 22, 18, 12, 22, 16, 14, 16, 14, 12];

function applyGroupingSheetLayout(ws: XLSX.WorkSheet, dataRowCount: number): void {
  const headerRow = 1;
  const lastCol = SHIPMENT_GROUPING_TEMPLATE_HEADERS.length - 1;
  const lastDataRow = Math.max(headerRow, headerRow + dataRowCount);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }];
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { c: 0, r: headerRow },
      e: { c: lastCol, r: lastDataRow },
    }),
  };
  (ws as XLSX.WorkSheet & { '!freeze'?: unknown })['!freeze'] = {
    xSplit: 0,
    ySplit: 2,
    topLeftCell: 'A3',
    activeCell: 'A3',
  };
  ws['!views'] = [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft' }];
  ws['!cols'] = GROUPING_COL_WIDTHS.map((wch) => ({ wch }));
  const dvEnd = Math.max(3, 2 + Math.max(dataRowCount, 1));
  (ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [
    {
      sqref: `A3:A${dvEnd}`,
      type: 'list',
      formulas: ['Y'],
      allowBlank: true,
      showErrorMessage: true,
      error: 'Isi Y atau biarkan kosong',
    },
  ];
}

function buildCaraIsiSheet(): XLSX.WorkSheet {
  const aoa = [
    ['Cara isi template grouping Unplanned → Preplanned'],
    [''],
    ['1. Isi kolom Select dengan Y untuk PO yang ikut batch ini.'],
    [
      '2. Isi kolom Group dengan kode bundel yang sama untuk PO yang akan satu kapal (contoh: 1, A, B).',
    ],
    ['3. Group bukan nama vessel. Vessel dan ETA diisi nanti saat membuat Planned shipment.'],
    ['4. Baris tanpa Y diabaikan saat upload, meskipun kolom Group terisi.'],
    ['5. Setiap Group harus berisi minimal 2 PO yang masih Unplanned.'],
    ['6. Urutan unduhan: Supplier, Region/Plant, Product, Incoterm, Contract Date, PO.'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 110 }];
  return ws;
}

export function buildShipmentGroupingTemplateXlsxBuffer(rows: GroupingTemplateDbRow[]): Buffer {
  const matrix = buildShipmentGroupingTemplateMatrixFromDb(rows);
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  applyGroupingSheetLayout(ws, rows.length);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHIPMENT_GROUPING_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, buildCaraIsiSheet(), SHIPMENT_GROUPING_HELP_SHEET_NAME);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}
