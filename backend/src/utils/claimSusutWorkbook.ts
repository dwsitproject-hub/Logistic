import * as XLSX from 'xlsx';
import { parseFlexibleIsoDate } from './parseFlexibleIsoDate';

/**
 * Reading the Claim Susut workbook: which sheets, and what their rows mean.
 *
 * The SAP export now arrives as one workbook with several sheets - PIVOT, OS_CLAIM, REAL_CLAIM.
 * The upload used to read `SheetNames[0]`, which in that file is PIVOT: a summary table, not claim
 * rows. Sheets are now found by NAME, and everything else in the workbook is ignored.
 *
 *   OS_CLAIM    outstanding claims - the main data. The view table, the filters and the Section 1
 *               aging dashboard are all computed from it. (The PIVOT sheet is that same aggregate,
 *               already summed; KLIP recomputes it rather than importing it.)
 *   REAL_CLAIM  claims approved in the period. Not derivable from OS_CLAIM - an approved claim
 *               leaves the outstanding list, and in the 31 Aug 2026 file none of the 5 realised CRs
 *               appears in OS_CLAIM, two of them opened and closed inside the same month. Optional:
 *               a workbook without it still imports its OS_CLAIM.
 *
 * Pure - no database - so each layout can be tested on its own.
 */

/** Upper-case, whitespace-collapsed header text. */
export function normHeader(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
};

// ---------------------------------------------------------------------------------------------
// Sheet selection

const sheetKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * `OS_CLAIM` in the current export, `OSClaim_Susut` in the one before it - the three imports
 * already in KLIP used that name. Both are accepted so an older file is not suddenly rejected.
 */
const OS_SHEET_KEYS = new Set(['OSCLAIM', 'OSCLAIMSUSUT']);
const REAL_SHEET_KEYS = new Set(['REALCLAIM', 'REALCLAIMSUSUT']);

export function findOsClaimSheet(sheetNames: string[], requested?: string | null): string | null {
  if (requested && sheetNames.includes(requested)) return requested;
  return sheetNames.find((n) => OS_SHEET_KEYS.has(sheetKey(n))) ?? null;
}

export function findRealClaimSheet(sheetNames: string[]): string | null {
  return sheetNames.find((n) => REAL_SHEET_KEYS.has(sheetKey(n))) ?? null;
}

/** "PERIODE : S/D 31 AUGUST 2026" -> "S/D 31 AUGUST 2026", from the title rows. */
export function readPeriodLabel(rows: unknown[][]): string | null {
  for (const row of rows.slice(0, 6)) {
    for (const cell of row ?? []) {
      const s = String(cell ?? '').replace(/\s+/g, ' ').trim();
      if (/^PERIODE\b/i.test(s)) {
        const after = s.replace(/^PERIODE\s*:?\s*/i, '').trim();
        return after || null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// OS_CLAIM

export interface OsClaimRow {
  vendorCode: string | null;
  vendorName: string | null;
  vendorType: string | null;
  createdBy: string | null;
  sta: string | null;
  crno: string | null;
  crDate: string | null;
  osDays: number | null;
  groupOfTransport: string | null;
  paymentMethod: string | null;
  dest: string | null;
  poNumber: string | null;
  contractExtNo: string | null;
  comm: string | null;
  commodity: string | null;
  materialDescription: string | null;
  uom: string | null;
  currency: string | null;
  companyCode: string | null;
  remarks: string | null;
  type: string | null;
  qtyClaim: number | null;
  amountBeforeTax: number | null;
  tax: number | null;
  amountAfterTax: number | null;
  raw: Record<string, unknown>;
  /** 1-based sheet row, for error messages. */
  sheetRow: number;
}

/**
 * Every column name the two OS layouts use. The current export splits several headers over two
 * rows ("OS" / "DAYS", "COMPA" / "CODE"), renamed "GROUP OF TRANSPORT" to "GROUP" and "DIAJUKAN"
 * to "QUANTITY", and dropped VENDOR TYPE, CREATED BY and METODE PAYMENT.
 */
const OS_COLUMNS = {
  vendorCode: ['VENDOR CODE', 'VENDORCODE'],
  vendorName: ['VENDOR NAME'],
  vendorType: ['VENDOR TYPE'],
  createdBy: ['CREATED BY', 'CREATEDBY'],
  sta: ['STA'],
  crno: ['CR NO', 'CRNO'],
  crDate: ['CR DATE'],
  osDays: ['OS DAYS', 'OUTSTANDING', 'OS'],
  groupOfTransport: ['GROUP OF TRANSPORT', 'GROUP'],
  paymentMethod: ['METODE PAYMENT'],
  dest: ['DEST'],
  poNumber: ['NO PO', 'NOPO'],
  contractExtNo: ['NO KONTRAK'],
  comm: ['COMM'],
  commodity: ['COMMODITY'],
  materialDescription: ['MATERIAL DESCRIPTION'],
  uom: ['UOM'],
  currency: ['CURRE'],
  companyCode: ['CODE', 'COMPANY CODE', 'COMPA', 'COMPA CODE'],
  remarks: ['KETERANGAN', 'REMARKS'],
  type: ['TYPE'],
  qtyClaim: ['DIAJUKAN', 'QUANTITY'],
  amountBeforeTax: ['AMOUNT BEFORE TAX(IDR)', 'AMOUNT BEFORE TAX (IDR)'],
  tax: ['TAX'],
  amountAfterTax: ['AMOUNT AFTER TAX(IDR)', 'AMOUNT AFTER TAX (IDR)', '(IDR)'],
} as const;

/**
 * What a claim row cannot do without. Deliberately the core both layouts share: VENDOR TYPE,
 * CREATED BY and METODE PAYMENT used to be required too, and the current export has none of them.
 */
const OS_REQUIRED: Array<{ label: string; field: keyof typeof OS_COLUMNS }> = [
  { label: 'VENDOR CODE', field: 'vendorCode' },
  { label: 'VENDOR NAME', field: 'vendorName' },
  { label: 'CR NO', field: 'crno' },
  { label: 'CR DATE', field: 'crDate' },
  { label: 'OS DAYS', field: 'osDays' },
  { label: 'GROUP', field: 'groupOfTransport' },
  { label: 'COMMODITY', field: 'commodity' },
  { label: 'AMOUNT AFTER TAX (IDR)', field: 'amountAfterTax' },
];

function findOsHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const set = new Set((rows[i] || []).map(normHeader).filter(Boolean));
    const hasVendor = set.has('VENDOR CODE') || set.has('VENDORCODE');
    const hasCr = set.has('CR NO') || set.has('CRNO') || set.has('CR DATE');
    const hasOs = set.has('OS DAYS') || set.has('OUTSTANDING') || set.has('OS');
    const hasPoOrContract = set.has('NO PO') || set.has('NOPO') || set.has('NO KONTRAK');
    if (hasVendor && hasCr && hasOs && hasPoOrContract) return i;
  }
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const set = new Set((rows[i] || []).map(normHeader).filter(Boolean));
    if (set.has('VENDOR CODE') || set.has('VENDORCODE')) return i;
  }
  return -1;
}

/**
 * One name per column from the three header rows.
 *
 * Both layouts repeat the header on the third row - the current one through formulas (=A6) - and
 * that repeat is the most reliable single row when present. Otherwise the deepest non-empty cell.
 */
function buildOsHeaders(rows: unknown[][], headerRowIndex: number): string[] {
  const row1 = rows[headerRowIndex] || [];
  const row2 = rows[headerRowIndex + 1] || [];
  const row3 = rows[headerRowIndex + 2] || [];
  const row3Set = new Set(row3.map(normHeader).filter(Boolean));
  const row3IsHeader =
    (row3Set.has('VENDOR CODE') || row3Set.has('VENDORCODE')) &&
    (row3Set.has('CR DATE') || row3Set.has('CR NO') || row3Set.has('CRNO'));
  const width = Math.max(row1.length, row2.length, row3.length);
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    headers.push((row3IsHeader ? normHeader(row3[c]) : '') || normHeader(row2[c]) || normHeader(row1[c]));
  }
  return headers;
}

export function parseOsClaimSheet(ws: XLSX.WorkSheet): {
  rows: OsClaimRow[];
  missing: string[];
  periodLabel: string | null;
  headerSheetRow: number | null;
} {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true }) as unknown[][];
  const origin = XLSX.utils.decode_range(ws['!ref'] || 'A1').s.r; // 0-based first row of the range
  const periodLabel = readPeriodLabel(rows);
  const headerRowIndex = findOsHeaderRowIndex(rows);
  if (headerRowIndex < 0) {
    return { rows: [], missing: OS_REQUIRED.map((r) => r.label), periodLabel, headerSheetRow: null };
  }
  const headers = buildOsHeaders(rows, headerRowIndex);
  const col: Partial<Record<keyof typeof OS_COLUMNS, number>> = {};
  for (const [field, names] of Object.entries(OS_COLUMNS) as Array<[keyof typeof OS_COLUMNS, readonly string[]]>) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  const missing = OS_REQUIRED.filter((r) => col[r.field] === undefined).map((r) => r.label);
  if (col.poNumber === undefined && col.contractExtNo === undefined) missing.push('NO PO or NO KONTRAK');
  if (missing.length > 0) {
    return { rows: [], missing, periodLabel, headerSheetRow: origin + headerRowIndex + 1 };
  }

  const at = (row: unknown[], f: keyof typeof OS_COLUMNS) => (col[f] === undefined ? null : row[col[f] as number]);
  const out: OsClaimRow[] = [];
  for (let i = headerRowIndex + 3; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.every((c) => c == null || String(c).trim() === '')) continue;
    const vendorCode = text(at(row, 'vendorCode'));
    const poNumber = text(at(row, 'poNumber'));
    const contractExtNo = text(at(row, 'contractExtNo'));
    if (!vendorCode && !contractExtNo && !poNumber) continue; // title, subtotal or spacer row
    const raw: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      if (h && row[c] != null && row[c] !== '') raw[h] = row[c];
    });
    const osDays = toNumberOrNull(at(row, 'osDays'));
    out.push({
      vendorCode,
      vendorName: text(at(row, 'vendorName')),
      vendorType: text(at(row, 'vendorType')),
      createdBy: text(at(row, 'createdBy')),
      sta: text(at(row, 'sta')),
      crno: text(at(row, 'crno')),
      crDate: parseFlexibleIsoDate(at(row, 'crDate')),
      osDays: osDays == null ? null : Math.trunc(osDays),
      groupOfTransport: text(at(row, 'groupOfTransport')),
      paymentMethod: text(at(row, 'paymentMethod')),
      dest: text(at(row, 'dest')),
      poNumber,
      contractExtNo,
      comm: text(at(row, 'comm')),
      commodity: text(at(row, 'commodity')),
      materialDescription: text(at(row, 'materialDescription')),
      uom: text(at(row, 'uom')),
      currency: text(at(row, 'currency')),
      companyCode: text(at(row, 'companyCode')),
      remarks: text(at(row, 'remarks')),
      type: text(at(row, 'type')),
      qtyClaim: toNumberOrNull(at(row, 'qtyClaim')),
      amountBeforeTax: toNumberOrNull(at(row, 'amountBeforeTax')),
      tax: toNumberOrNull(at(row, 'tax')),
      amountAfterTax: toNumberOrNull(at(row, 'amountAfterTax')),
      raw,
      sheetRow: origin + i + 1,
    });
  }
  return { rows: out, missing: [], periodLabel, headerSheetRow: origin + headerRowIndex + 1 };
}

// ---------------------------------------------------------------------------------------------
// REAL_CLAIM

export interface RealClaimRow {
  vendorCode: string | null;
  vendorName: string | null;
  cargoSource: string | null;
  crNo: string;
  claimDate: string | null;
  cmDate: string | null;
  poCnDate: string | null;
  poNumber: string | null;
  comm: string | null;
  commodity: string | null;
  materialDescription: string | null;
  dest: string | null;
  statusClaim: string | null;
  companyCode: string | null;
  typeOfClaim: string | null;
  currency: string | null;
  qtyApproved: number | null;
  uom: string | null;
  amountBeforeTax: number | null;
  tax: number | null;
  amountAfterTax: number | null;
  remarks: string | null;
  /** SURVEYOR / TRUCKING / VESSEL VOYAGE / ... - the part of KETERANGAN before the first "//". */
  transportGroup: string | null;
  raw: Record<string, unknown>;
  sheetRow: number;
}

const REAL_COLUMNS = {
  vendorCode: ['VENDOR CODE'],
  vendorName: ['VENDOR DESCRIPTION', 'VENDOR NAME'],
  cargoSource: ['CARGO SOURCE'],
  crNo: ['NO CR', 'CR NO'],
  claimDate: ['CLAIM DATE'],
  cmDate: ['CM DATE'],
  poCnDate: ['PO CN DATE'],
  poNumber: ['NO PO'],
  comm: ['COMM'],
  commodity: ['COMMODITY'],
  materialDescription: ['MATERIAL DESCRIPTION'],
  dest: ['DEST'],
  statusClaim: ['STA CLA', 'STATUS CLAIM', 'STA'],
  companyCode: ['COMPA CODE', 'COMPANY CODE', 'CODE'],
  typeOfClaim: ['TYPE OF CLAIM', 'TYPE CLAIM', 'TYPE'],
  currency: ['CURRE', 'CURRENCY'],
  qtyApproved: ['QUANTITY'],
  uom: ['UOM'],
  amountBeforeTax: ['AMOUNT BEFORE TAX (IDR)', 'AMOUNT BEFORE TAX(IDR)'],
  tax: ['TAX (IDR)', 'TAX'],
  amountAfterTax: ['AMOUNT AFTER TAX (IDR)', 'AMOUNT AFTER TAX(IDR)'],
  remarks: ['KETERANGAN'],
} as const;

const REAL_REQUIRED: Array<{ label: string; field: keyof typeof REAL_COLUMNS }> = [
  { label: 'VENDOR CODE', field: 'vendorCode' },
  { label: 'NO CR', field: 'crNo' },
  { label: 'QUANTITY', field: 'qtyApproved' },
  { label: 'AMOUNT AFTER TAX (IDR)', field: 'amountAfterTax' },
];

/**
 * One name per column, joined from the header block.
 *
 * REAL_CLAIM spreads its headers over four rows and merges banners across them: "JUMLAH CLAIM
 * DISETUJUI" and "SURAT CLAIM KETERANGAN" each span R:V, above QUANTITY / UOM / AMOUNT BEFORE ...
 * A banner names a GROUP of columns, not any one of them, so a cell that starts a merge spanning
 * more than one column is left out. What remains, joined top to bottom, is the column's own name:
 * "AMOUNT BEFORE" + "TAX (IDR)", "TYPE OF" + "CLAIM", "COMPA" + "CODE".
 */
function buildJoinedHeaders(
  rows: unknown[][],
  fromIndex: number,
  toIndex: number,
  bannerCells: Set<string>,
): string[] {
  const width = Math.max(...rows.slice(fromIndex, toIndex + 1).map((r) => (r || []).length), 0);
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const parts: string[] = [];
    for (let r = fromIndex; r <= toIndex; r++) {
      if (bannerCells.has(`${r}:${c}`)) continue;
      const v = normHeader((rows[r] || [])[c]);
      if (v) parts.push(v);
    }
    headers.push(parts.join(' '));
  }
  return headers;
}

export function parseRealClaimSheet(ws: XLSX.WorkSheet): {
  rows: RealClaimRow[];
  missing: string[];
  periodLabel: string | null;
} {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true }) as unknown[][];
  const origin = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const periodLabel = readPeriodLabel(rows);

  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const set = new Set((rows[i] || []).map(normHeader).filter(Boolean));
    if (set.has('VENDOR CODE') && (set.has('NO CR') || set.has('CR NO'))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) return { rows: [], missing: REAL_REQUIRED.map((r) => r.label), periodLabel };

  // Merge coordinates are sheet-absolute; rows[] starts at the range origin.
  const bannerCells = new Set<string>();
  for (const m of ws['!merges'] || []) {
    if (m.e.c > m.s.c) bannerCells.add(`${m.s.r - origin.s.r}:${m.s.c - origin.s.c}`);
  }

  // The header block: the row above (row 5, with STA and COMPA) through the continuation rows,
  // stopping at the first row that carries a CR number - that is data.
  const crProbe = (rows[headerIndex] || []).map(normHeader).findIndex((h) => h === 'NO CR' || h === 'CR NO');
  let lastHeader = headerIndex;
  for (let r = headerIndex + 1; r < Math.min(rows.length, headerIndex + 4); r++) {
    if (text((rows[r] || [])[crProbe])) break;
    lastHeader = r;
  }
  const headers = buildJoinedHeaders(rows, Math.max(0, headerIndex - 1), lastHeader, bannerCells);

  const col: Partial<Record<keyof typeof REAL_COLUMNS, number>> = {};
  for (const [field, names] of Object.entries(REAL_COLUMNS) as Array<[keyof typeof REAL_COLUMNS, readonly string[]]>) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  const missing = REAL_REQUIRED.filter((r) => col[r.field] === undefined).map((r) => r.label);
  if (missing.length > 0) return { rows: [], missing, periodLabel };

  const at = (row: unknown[], f: keyof typeof REAL_COLUMNS) => (col[f] === undefined ? null : row[col[f] as number]);
  const out: RealClaimRow[] = [];
  // A vendor's name is written on its first claim only; the rows under it belong to it too.
  let vendorCode: string | null = null;
  let vendorName: string | null = null;
  for (let i = lastHeader + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const code = text(at(row, 'vendorCode'));
    if (code && /TOTAL/i.test(code)) continue; // SUB TOTAL / GRANDTOTAL
    const crNo = text(at(row, 'crNo'));
    if (code) {
      vendorCode = code;
      vendorName = text(at(row, 'vendorName'));
    }
    if (!crNo) continue;
    const remarks = text(at(row, 'remarks'));
    const prefix = remarks && remarks.includes('//') ? remarks.split('//')[0].trim().toUpperCase() : null;
    const raw: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      if (h && row[c] != null && row[c] !== '') raw[h] = row[c];
    });
    out.push({
      vendorCode,
      vendorName,
      cargoSource: text(at(row, 'cargoSource')),
      crNo,
      claimDate: parseFlexibleIsoDate(at(row, 'claimDate')),
      cmDate: parseFlexibleIsoDate(at(row, 'cmDate')),
      poCnDate: parseFlexibleIsoDate(at(row, 'poCnDate')),
      poNumber: text(at(row, 'poNumber')),
      comm: text(at(row, 'comm')),
      commodity: text(at(row, 'commodity')),
      materialDescription: text(at(row, 'materialDescription')),
      dest: text(at(row, 'dest')),
      statusClaim: text(at(row, 'statusClaim')),
      companyCode: text(at(row, 'companyCode')),
      typeOfClaim: text(at(row, 'typeOfClaim')),
      currency: text(at(row, 'currency')),
      qtyApproved: toNumberOrNull(at(row, 'qtyApproved')),
      uom: text(at(row, 'uom')),
      amountBeforeTax: toNumberOrNull(at(row, 'amountBeforeTax')),
      tax: toNumberOrNull(at(row, 'tax')),
      amountAfterTax: toNumberOrNull(at(row, 'amountAfterTax')),
      remarks,
      transportGroup: prefix && prefix.length <= 40 ? prefix : null,
      raw,
      sheetRow: origin.s.r + i + 1,
    });
  }
  return { rows: out, missing: [], periodLabel };
}
