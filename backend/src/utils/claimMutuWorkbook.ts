import * as XLSX from 'xlsx';
import { parseFlexibleIsoDate } from './parseFlexibleIsoDate';

/**
 * Reading the Claim Mutu workbook.
 *
 * The SAP export carries outstanding (OS) and realised (Real) quality claims, each twice: Include
 * B2B and Exclude B2B, plus four summary sheets. The summaries are NOT imported - every one of them
 * is recomputed from the detail rows (checked cell by cell on the 31 Aug 2026 file: Summary Per
 * Komoditi 96/96, Rekap Per Lokasi 28/28, Pivot 16/16 from the Exclude rows; Summary Per Unit
 * 72/72 from the Include rows).
 *
 * Which rows are B2B is the claim team's own call. It follows from no column - the four B2B Real
 * rows share every attribute with 81 that are not - and it disagrees with SAP's B2B flag (3 of the
 * 10 POs they treat as B2B are DIRECT in SAP). So the Include sheet is stored and each row is
 * marked B2B exactly when the Exclude sheet of the same file does not contain it.
 *
 * Pure - no database.
 */

export function normHeader(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
};

// ---------------------------------------------------------------------------------------------
// Reference data

/**
 * DEST code -> discharge unit, as the Summary Per Komoditi / Summary Per Unit sheets name them.
 * Derived from the workbook's own pairing of Rekap Per Lokasi codes with unit names, and proven by
 * recomputing Summary Per Unit from the detail rows (72/72). KRG and KRW are both KARAWANG.
 * A code missing here is shown as itself and reported on the import, never guessed.
 */
export const CLAIM_MUTU_DEST_UNITS: Readonly<Record<string, string>> = {
  BKS: 'BEKASI',
  BTG: 'BONTANG',
  JMB: 'JAMBI',
  KJG: 'TANJUNG PURA',
  KMI: 'KUMAI',
  KRG: 'KARAWANG',
  KRW: 'KARAWANG',
  LGU: 'LUBUK GAUNG',
  PLB: 'PALEMBANG',
  SAL: 'SALO PALAI',
  TGR: 'TANGERANG',
  TJB: 'TANJUNG BUTON',
  TJM: 'TANJUNG MORAWA',
  TRD: 'JAKARTA (TRADING PLANT)',
};

export function unitForDest(dest: string | null): string | null {
  if (!dest) return null;
  return CLAIM_MUTU_DEST_UNITS[dest.trim().toUpperCase()] ?? dest.trim().toUpperCase();
}

/**
 * The commodity as the summary sheets group it.
 *
 * SAP writes "WASTE OIL (POME" - the field is cut before the closing bracket - while the summaries
 * say "WASTE OIL (POME)"; without this every POME cell compares as zero. A blank commodity whose
 * material is shell is SHELL PALM, which is the rule the Summary Per Komoditi sheet states for the
 * one such Real row in the August file.
 */
export function normalizeClaimMutuCommodity(commodity: unknown, material: unknown): string | null {
  let c = String(commodity ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (c === 'WASTE OIL (POME') c = 'WASTE OIL (POME)';
  if (!c && /SHELL/i.test(String(material ?? ''))) c = 'SHELL PALM';
  return c || null;
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, JANUARI: 1, FEBRUARY: 2, FEBRUARI: 2, MARCH: 3, MARET: 3, APRIL: 4, MAY: 5, MEI: 5,
  JUNE: 6, JUNI: 6, JULY: 7, JULI: 7, AUGUST: 8, AGUSTUS: 8, SEPTEMBER: 9, OCTOBER: 10, OKTOBER: 10,
  NOVEMBER: 11, DECEMBER: 12, DESEMBER: 12,
};

/**
 * "S/D 31 AUGUST 2026" -> "2026-08-01": the month a file describes, which is what places an import
 * on the Summary Per Unit trend. The last month name in the label wins ("1 S/D 31 AUGUST 2026").
 */
export function periodMonthFromLabel(label: string | null): string | null {
  if (!label) return null;
  const up = label.toUpperCase();
  let found: { month: number; year: number } | null = null;
  const re = /([A-Z]+)\s+(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(up))) {
    const month = MONTHS[m[1]];
    if (month) found = { month, year: Number(m[2]) };
  }
  return found ? `${found.year}-${String(found.month).padStart(2, '0')}-01` : null;
}

export function readPeriodLabel(rows: unknown[][]): string | null {
  for (const row of rows.slice(0, 6)) {
    for (const cell of row ?? []) {
      const s = String(cell ?? '').replace(/\s+/g, ' ').trim();
      if (/^PERIODE\b/i.test(s)) return s.replace(/^PERIODE\s*:?\s*/i, '').trim() || null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sheets

const sheetKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface ClaimMutuSheets {
  osInc: string | null;
  osExc: string | null;
  realInc: string | null;
  realExc: string | null;
  /** The single-sheet OSCLAIM-ALLREGION export the previous import read. */
  osLegacy: string | null;
}

export function findClaimMutuSheets(names: string[]): ClaimMutuSheets {
  const pick = (...keys: string[]) => names.find((n) => keys.includes(sheetKey(n))) ?? null;
  return {
    osInc: pick('OSCLAIMINCB2B'),
    osExc: pick('OSCLAIMEXCB2B'),
    realInc: pick('REALCLAIMINCB2B'),
    realExc: pick('REALCLAIMEXCB2B'),
    osLegacy: names.find((n) => sheetKey(n).includes('OSCLAIMALLREGION')) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Header block

type Mutu = { ffa: number | null; mi: number | null; dns: number | null; dobi: number | null };

interface HeaderBlock {
  /** Index of the row naming VENDOR CODE. */
  mainRow: number;
  /** First data row. */
  dataRow: number;
  /** Per column: the header texts from the main row down, repeats of the main row left out. */
  parts: string[][];
  /** Mutu groups: first column of each labelled group of four. */
  mutuStart: Record<string, number>;
}

/**
 * The header block: the row with VENDOR CODE and the continuation rows under it, up to the first
 * row carrying `dataProbe` (CR NO / NO CR) - that is data. A continuation row that repeats the main
 * row (the Exclude OS sheet has one, filled by formulas) adds nothing and is skipped.
 *
 * Mutu groups ("MUTU KONTRAK", "MUTU KLAIM" / "MUTU CLAIM") label only their first column, above
 * FFA / M&I / DNS / DOBI. Read column by column, the two M&I columns would be indistinguishable, so
 * a group's four sub-columns are resolved by position from where its label sits - in the main row
 * or, as in Real Claim, in the banner row above it.
 */
function readHeaderBlock(rows: unknown[][], probeNames: string[]): HeaderBlock | null {
  let mainRow = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const set = new Set((rows[i] || []).map(normHeader));
    if (set.has('VENDOR CODE') && probeNames.some((p) => set.has(p))) {
      mainRow = i;
      break;
    }
  }
  if (mainRow < 0) return null;
  const main = (rows[mainRow] || []).map(normHeader);
  const probe = main.findIndex((h) => probeNames.includes(h));
  const mainSig = main.filter(Boolean).join('|');

  let dataRow = mainRow + 1;
  const extra: number[] = [];
  for (let r = mainRow + 1; r < Math.min(rows.length, mainRow + 5); r++) {
    const row = rows[r] || [];
    const sig = row.map(normHeader).filter(Boolean).join('|');
    const probeVal = text(row[probe]);
    if (probeVal && sig !== mainSig && /\d/.test(probeVal)) break; // a CR number: data begins
    if (sig !== mainSig) extra.push(r);
    dataRow = r + 1;
  }
  const width = Math.max(...[mainRow, ...extra].map((r) => (rows[r] || []).length), main.length);
  const parts: string[][] = [];
  for (let c = 0; c < width; c++) {
    const p = [main[c], ...extra.map((r) => normHeader((rows[r] || [])[c]))].filter(Boolean);
    parts.push(p);
  }

  const mutuStart: Record<string, number> = {};
  for (const r of [mainRow - 1, mainRow]) {
    if (r < 0) continue;
    (rows[r] || []).forEach((v, c) => {
      const h = normHeader(v);
      if (h === 'MUTU KONTRAK') mutuStart.kontrak = c;
      if (h === 'MUTU KLAIM' || h === 'MUTU CLAIM') mutuStart.klaim = c;
    });
  }
  return { mainRow, dataRow, parts, mutuStart };
}

/** First column whose header parts satisfy `test`. */
function findCol(block: HeaderBlock, test: (parts: string[]) => boolean): number | undefined {
  const i = block.parts.findIndex((p) => p.length > 0 && test(p));
  return i >= 0 ? i : undefined;
}
const is = (...names: string[]) => (p: string[]) => names.includes(p[0]);
const has = (name: string) => (p: string[]) => p.includes(name);
const startsWith = (prefix: string) => (p: string[]) => p.some((x) => x.startsWith(prefix));

function readMutu(block: HeaderBlock, row: unknown[], group: 'kontrak' | 'klaim'): Mutu {
  const start = block.mutuStart[group];
  const empty: Mutu = { ffa: null, mi: null, dns: null, dobi: null };
  if (start === undefined) return empty;
  const out = { ...empty };
  for (let c = start; c < start + 4; c++) {
    const label = block.parts[c]?.[block.parts[c].length - 1] ?? '';
    const v = toNumberOrNull(row[c]);
    if (label.startsWith('FFA')) out.ffa = v;
    else if (label === 'M&I') out.mi = v;
    else if (label === 'DNS') out.dns = v;
    else if (label === 'DOBI') out.dobi = v;
  }
  return out;
}

function rawOf(block: HeaderBlock, row: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  block.parts.forEach((p, c) => {
    if (p.length && row[c] != null && row[c] !== '') raw[p.join(' ')] = row[c];
  });
  return raw;
}

// ---------------------------------------------------------------------------------------------
// OS

export interface ClaimMutuOsRow {
  vendorCode: string | null;
  vendorName: string | null;
  groupOfVendor: string | null;
  vendorType: string | null;
  cargoSource: string | null;
  keterangan: string | null;
  metodePayment: string | null;
  /** 3RD PARTY (SUPPLIER) / 3RD PARTY (SURVEYOR) / 3RD PARTY (TRANSPORTIR) / INTERCO (...) */
  claimGroup: string | null;
  typeOfComp: string | null;
  traders: string | null;
  createdBy: string | null;
  sta: string | null;
  crNo: string | null;
  crDate: string | null;
  osDays: number | null;
  dest: string | null;
  unit: string | null;
  poNumber: string | null;
  contractExtNo: string | null;
  comm: string | null;
  commodity: string | null;
  materialDescription: string | null;
  companyCode: string | null;
  mutuKontrak: Mutu;
  mutuKlaim: Mutu;
  claimType: string | null;
  qtyKg: number | null;
  uom: string | null;
  amountBeforeTax: number | null;
  tax: number | null;
  amountAfterTax: number | null;
  raw: Record<string, unknown>;
  sheetRow: number;
}

const OS_REQUIRED = ['VENDOR CODE', 'CR NO', 'OS DAYS', 'DEST', 'COMMODITY', 'AMOUNT AFTER TAX (IDR)'];

export function parseClaimMutuOsSheet(ws: XLSX.WorkSheet): {
  rows: ClaimMutuOsRow[];
  missing: string[];
  periodLabel: string | null;
} {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true }) as unknown[][];
  const origin = XLSX.utils.decode_range(ws['!ref'] || 'A1').s.r;
  const periodLabel = readPeriodLabel(rows);
  const block = readHeaderBlock(rows, ['CR NO']);
  if (!block) return { rows: [], missing: OS_REQUIRED, periodLabel };

  const col = {
    vendorCode: findCol(block, is('VENDOR CODE')),
    vendorName: findCol(block, is('VENDOR NAME')),
    groupOfVendor: findCol(block, is('GROUP OF VENDOR')),
    vendorType: findCol(block, is('VENDOR TYPE')),
    cargoSource: findCol(block, is('CARGO SOURCE')),
    keterangan: findCol(block, is('KETERANGAN')),
    metodePayment: findCol(block, is('METODE PAYMENT')),
    claimGroup: findCol(block, is('GROUP')),
    typeOfComp: findCol(block, is('TYPE OF COMP')),
    traders: findCol(block, is('TRADERS')),
    createdBy: findCol(block, is('CREATED BY')),
    sta: findCol(block, is('STA')),
    crNo: findCol(block, is('CR NO')),
    crDate: findCol(block, is('CR DATE')),
    osDays: findCol(block, is('OS', 'OS DAYS')),
    dest: findCol(block, is('DEST')),
    poNumber: findCol(block, is('NO PO')),
    contractExtNo: findCol(block, is('NO KONTRAK')),
    comm: findCol(block, is('COMM')),
    commodity: findCol(block, is('COMMODITY')),
    material: findCol(block, is('MATERIAL DESCRIPTION')),
    companyCode: findCol(block, is('CODE', 'COMP', 'COMPA', 'COMPANY CODE')),
    claimType: findCol(block, is('TYPE')),
    qty: findCol(block, has('QUANTITY')),
    uom: findCol(block, is('UOM')),
    amountBefore: findCol(block, startsWith('AMOUNT BEFORE')),
    tax: findCol(block, is('TAX')),
    amountAfter: findCol(block, startsWith('AMOUNT AFTER')),
  };
  const missing: string[] = [];
  if (col.vendorCode === undefined) missing.push('VENDOR CODE');
  if (col.crNo === undefined) missing.push('CR NO');
  if (col.osDays === undefined) missing.push('OS DAYS');
  if (col.dest === undefined) missing.push('DEST');
  if (col.commodity === undefined) missing.push('COMMODITY');
  if (col.amountAfter === undefined) missing.push('AMOUNT AFTER TAX (IDR)');
  if (missing.length) return { rows: [], missing, periodLabel };

  const at = (row: unknown[], c: number | undefined) => (c === undefined ? null : row[c]);
  const out: ClaimMutuOsRow[] = [];
  for (let i = block.dataRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const vendorCode = text(at(row, col.vendorCode));
    if (vendorCode && /TOTAL/i.test(vendorCode)) continue; // SUB TOTAL rows in the Include sheet
    const crNo = text(at(row, col.crNo));
    if (!crNo) continue;
    const dest = text(at(row, col.dest));
    const osDays = toNumberOrNull(at(row, col.osDays));
    const material = text(at(row, col.material));
    out.push({
      vendorCode,
      vendorName: text(at(row, col.vendorName)),
      groupOfVendor: text(at(row, col.groupOfVendor)),
      vendorType: text(at(row, col.vendorType)),
      cargoSource: text(at(row, col.cargoSource)),
      keterangan: text(at(row, col.keterangan)),
      metodePayment: text(at(row, col.metodePayment)),
      claimGroup: text(at(row, col.claimGroup)),
      typeOfComp: text(at(row, col.typeOfComp)),
      traders: text(at(row, col.traders)),
      createdBy: text(at(row, col.createdBy)),
      sta: text(at(row, col.sta)),
      crNo,
      crDate: parseFlexibleIsoDate(at(row, col.crDate)),
      osDays: osDays == null ? null : Math.trunc(osDays),
      dest,
      unit: unitForDest(dest),
      poNumber: text(at(row, col.poNumber)),
      contractExtNo: text(at(row, col.contractExtNo)),
      comm: text(at(row, col.comm)),
      commodity: normalizeClaimMutuCommodity(at(row, col.commodity), material),
      materialDescription: material,
      companyCode: text(at(row, col.companyCode)),
      mutuKontrak: readMutu(block, row, 'kontrak'),
      mutuKlaim: readMutu(block, row, 'klaim'),
      claimType: text(at(row, col.claimType)),
      qtyKg: toNumberOrNull(at(row, col.qty)),
      uom: text(at(row, col.uom)),
      amountBeforeTax: toNumberOrNull(at(row, col.amountBefore)),
      tax: toNumberOrNull(at(row, col.tax)),
      amountAfterTax: toNumberOrNull(at(row, col.amountAfter)),
      raw: rawOf(block, row),
      sheetRow: origin + i + 1,
    });
  }
  return { rows: out, missing: [], periodLabel };
}

// ---------------------------------------------------------------------------------------------
// Real

export interface ClaimMutuRealRow {
  vendorCode: string | null;
  vendorName: string | null;
  groupKey: string | null;
  vendorType: string | null;
  cargoSource: string | null;
  traders: string | null;
  kebun: string | null;
  crNo: string;
  claimDate: string | null;
  cmNo: string | null;
  cmDate: string | null;
  poNumber: string | null;
  contractExtNo: string | null;
  comm: string | null;
  commodity: string | null;
  materialDescription: string | null;
  dest: string | null;
  unit: string | null;
  statusClaim: string | null;
  companyCode: string | null;
  mutuKontrak: Mutu;
  mutuKlaim: Mutu;
  claimType: string | null;
  qtyKg: number | null;
  uom: string | null;
  amountBeforeTax: number | null;
  tax: number | null;
  amountAfterTax: number | null;
  raw: Record<string, unknown>;
  sheetRow: number;
}

export function parseClaimMutuRealSheet(ws: XLSX.WorkSheet): {
  rows: ClaimMutuRealRow[];
  missing: string[];
  periodLabel: string | null;
} {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true }) as unknown[][];
  const origin = XLSX.utils.decode_range(ws['!ref'] || 'A1').s.r;
  const periodLabel = readPeriodLabel(rows);
  const block = readHeaderBlock(rows, ['NO CR', 'CR NO']);
  if (!block) return { rows: [], missing: ['VENDOR CODE', 'NO CR'], periodLabel };

  const col = {
    vendorCode: findCol(block, is('VENDOR CODE')),
    vendorName: findCol(block, is('VENDOR DESCRIPTION', 'VENDOR NAME')),
    groupKey: findCol(block, is('GROUP KEY')),
    vendorType: findCol(block, is('VENDOR TYPE')),
    cargoSource: findCol(block, is('CARGO SOURCE')),
    traders: findCol(block, is('TRADERS')),
    kebun: findCol(block, is('KEBUN')),
    crNo: findCol(block, is('NO CR', 'CR NO')),
    claimDate: findCol(block, is('CLAIM DATE')),
    cmNo: findCol(block, is('CM NO')),
    cmDate: findCol(block, is('CM DATE')),
    poNumber: findCol(block, is('NO PO')),
    contractExtNo: findCol(block, is('NO KONTRAK')),
    comm: findCol(block, is('COMM')),
    commodity: findCol(block, is('COMMODITY')),
    material: findCol(block, is('MATERIAL DESCRIPTION')),
    dest: findCol(block, is('DEST')),
    statusClaim: findCol(block, is('CLA', 'STA')),
    companyCode: findCol(block, is('CODE', 'COMPA', 'COMPANY CODE')),
    claimType: findCol(block, (p) => p[0] === 'TYPE OF' && p.includes('CLAIM')),
    qty: findCol(block, has('QUANTITY')),
    uom: findCol(block, has('UOM')),
    amountBefore: findCol(block, startsWith('AMOUNT BEFORE')),
    tax: findCol(block, (p) => p.includes('TAX') && !p.some((x) => x.startsWith('AMOUNT'))),
    amountAfter: findCol(block, startsWith('AMOUNT AFTER')),
  };
  const missing: string[] = [];
  if (col.vendorCode === undefined) missing.push('VENDOR CODE');
  if (col.crNo === undefined) missing.push('NO CR');
  if (col.qty === undefined) missing.push('QUANTITY');
  if (col.amountAfter === undefined) missing.push('AMOUNT AFTER TAX (IDR)');
  if (missing.length) return { rows: [], missing, periodLabel };

  const at = (row: unknown[], c: number | undefined) => (c === undefined ? null : row[c]);
  const out: ClaimMutuRealRow[] = [];
  // A vendor's name may be written on its first claim only.
  let vendor = { code: null as string | null, name: null as string | null, key: null as string | null, type: null as string | null };
  for (let i = block.dataRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const code = text(at(row, col.vendorCode));
    if (code && /TOTAL/i.test(code)) continue;
    if (code) {
      vendor = {
        code,
        name: text(at(row, col.vendorName)),
        key: text(at(row, col.groupKey)),
        type: text(at(row, col.vendorType)),
      };
    }
    const crNo = text(at(row, col.crNo));
    if (!crNo) continue;
    const dest = text(at(row, col.dest));
    const material = text(at(row, col.material));
    out.push({
      vendorCode: vendor.code,
      vendorName: vendor.name,
      groupKey: text(at(row, col.groupKey)) ?? vendor.key,
      vendorType: text(at(row, col.vendorType)) ?? vendor.type,
      cargoSource: text(at(row, col.cargoSource)),
      traders: text(at(row, col.traders)),
      kebun: text(at(row, col.kebun)),
      crNo,
      claimDate: parseFlexibleIsoDate(at(row, col.claimDate)),
      cmNo: text(at(row, col.cmNo)),
      cmDate: parseFlexibleIsoDate(at(row, col.cmDate)),
      poNumber: text(at(row, col.poNumber)),
      contractExtNo: text(at(row, col.contractExtNo)),
      comm: text(at(row, col.comm)),
      commodity: normalizeClaimMutuCommodity(at(row, col.commodity), material),
      materialDescription: material,
      dest,
      unit: unitForDest(dest),
      statusClaim: text(at(row, col.statusClaim)),
      companyCode: text(at(row, col.companyCode)),
      mutuKontrak: readMutu(block, row, 'kontrak'),
      mutuKlaim: readMutu(block, row, 'klaim'),
      claimType: text(at(row, col.claimType)),
      qtyKg: toNumberOrNull(at(row, col.qty)),
      uom: text(at(row, col.uom)),
      amountBeforeTax: toNumberOrNull(at(row, col.amountBefore)),
      tax: toNumberOrNull(at(row, col.tax)),
      amountAfterTax: toNumberOrNull(at(row, col.amountAfter)),
      raw: rawOf(block, row),
      sheetRow: origin + i + 1,
    });
  }
  return { rows: out, missing: [], periodLabel };
}

// ---------------------------------------------------------------------------------------------
// B2B

const money = (n: number | null) => (n == null ? '' : n.toFixed(2));

/**
 * Mark each Include row B2B when the Exclude sheet of the same file does not hold it.
 *
 * Matched as a multiset on the identifying fields, so a claim listed twice in Include and once in
 * Exclude marks exactly one of the two - the August file has such pairs (PO 1001027387, 9231000078).
 */
export function markB2bByExclusion<T>(
  includeRows: T[],
  excludeRows: T[],
  key: (row: T) => string,
): Array<T & { isB2b: boolean }> {
  const remaining = new Map<string, number>();
  for (const r of excludeRows) remaining.set(key(r), (remaining.get(key(r)) ?? 0) + 1);
  return includeRows.map((r) => {
    const k = key(r);
    const left = remaining.get(k) ?? 0;
    if (left > 0) {
      remaining.set(k, left - 1);
      return { ...r, isB2b: false };
    }
    return { ...r, isB2b: true };
  });
}

export const osMatchKey = (r: ClaimMutuOsRow) => [r.crNo, r.poNumber, money(r.amountAfterTax)].join('|');
export const realMatchKey = (r: ClaimMutuRealRow) =>
  [r.crNo, r.cmNo, r.poNumber, money(r.amountAfterTax)].join('|');

/** Exclude rows the Include sheet does not hold - a file whose two sheets disagree. */
export function unmatchedExcludeCount<T>(includeRows: T[], excludeRows: T[], key: (row: T) => string): number {
  const remaining = new Map<string, number>();
  for (const r of includeRows) remaining.set(key(r), (remaining.get(key(r)) ?? 0) + 1);
  let missing = 0;
  for (const r of excludeRows) {
    const left = remaining.get(key(r)) ?? 0;
    if (left > 0) remaining.set(key(r), left - 1);
    else missing++;
  }
  return missing;
}
