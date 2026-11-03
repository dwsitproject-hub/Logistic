import * as XLSX from 'xlsx';

/**
 * Reading the SAP "Claim Data" exports (OSCLAIM and REALCLAIM, `.xls`).
 *
 * One file holds MUTU (quality) and SUSUT (shortage) claims together, split by `TYPE (OF) CLAIM`,
 * spread over many sheets ("pages"). Every sheet repeats its own header block, carries SUB TOTAL
 * rows, and the last one ends in a GRAND TOTAL - none of those are claims.
 *
 * - OSCLAIM  = outstanding (not yet paid). Quantity / amount are the "JLH CLAIM DIAJUKAN" block.
 * - REALCLAIM = realised (paid). Quantity / amount are the "JUMLAH CLAIM DISETUJUI" (approved) block.
 *
 * Quirks handled here (checked against the January - October 2026 files):
 * - Text carries HTML entities (`&#x2f;` for "/") that must be decoded.
 * - Dates are mixed: ~30% Excel serial numbers, ~70% text `dd.mm.yyyy`. Every numeric serial has a
 *   day <= 12 and every text date a day > 12, i.e. the numeric ones were day/month swapped by a
 *   locale bug in the export. Numeric serials are therefore read with day and month swapped back.
 *   "00.00.0000" is a blank.
 * - A vendor's code/name is written on its first claim only; the rows under it belong to it too.
 *
 * Pure - no database.
 */

export type ClaimDataKind = 'os' | 'real';
export type ClaimDataClaimType = 'MUTU' | 'SUSUT';

export interface ClaimDataMutu {
  ffa: number | null;
  mi: number | null;
  dns: number | null;
  dobi: number | null;
}

export interface ClaimDataRow {
  kind: ClaimDataKind;
  sheetName: string;
  /** 1-based sheet row, for error messages. */
  sheetRow: number;
  claimType: ClaimDataClaimType | null;
  typeRaw: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  groupOfVendor: string | null;
  groupKey: string | null;
  vendorType: string | null;
  cargoSource: string | null;
  traders: string | null;
  kebun: string | null;
  createdBy: string | null;
  sta: string | null;
  crNo: string;
  crDate: string | null;
  cmNo: string | null;
  cmDate: string | null;
  poCnDate: string | null;
  /** OUTSTANDING DAYS as the file states it (OS only). KLIP recomputes it from CR date. */
  osDaysFile: number | null;
  dest: string | null;
  poNumber: string | null;
  contractExtNo: string | null;
  comm: string | null;
  commodity: string | null;
  materialDescription: string | null;
  companyCode: string | null;
  currency: string | null;
  uom: string | null;
  keterangan: string | null;
  /** SURVEYOR / TRUCKING / VESSEL ... - the part of KETERANGAN before the first "//". */
  transportGroup: string | null;
  mutuKontrak: ClaimDataMutu;
  mutuKlaim: ClaimDataMutu;
  /** OS: quantity claimed. Real: quantity approved. */
  qty: number | null;
  /** Real only: quantity claimed (before approval). */
  qtySubmitted: number | null;
  /** OS: amount claimed. Real: amount approved. All IDR. */
  amountBeforeTax: number | null;
  tax: number | null;
  amountAfterTax: number | null;
  raw: Record<string, unknown>;
}

export interface ClaimDataParseResult {
  kind: ClaimDataKind;
  rows: ClaimDataRow[];
  /** Fatal problems: nothing was imported. */
  errors: string[];
  /** Non-fatal observations the uploader should see. */
  warnings: string[];
  sheetsRead: number;
  sheetsSkipped: string[];
  subtotalRowsSkipped: number;
  /** What the file's own GRAND TOTAL row says, summed over sheets, and what the rows add up to. */
  reportedTotals: { qty: number; amountAfterTax: number } | null;
  rowTotals: { qty: number; amountAfterTax: number };
}

// ---------------------------------------------------------------------------------------------
// Primitives

const ENTITY_RE = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeClaimDataEntities(s: string): string {
  return s.replace(ENTITY_RE, (_m, hex, dec, named) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return NAMED[String(named).toLowerCase()] ?? _m;
  });
}

/** Header comparison form: decoded, whitespace collapsed, upper case. */
export function normClaimDataHeader(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? decodeClaimDataEntities(v) : String(v);
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = (typeof v === 'string' ? decodeClaimDataEntities(v) : String(v)).replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Claim dates: text `dd.mm.yyyy` as written; numeric Excel serials with day and month swapped back
 * (see the file header). A serial whose day is above 12 cannot have been swapped and is kept as is.
 */
export function parseClaimDataDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const whole = Math.floor(v);
    if (!Number.isFinite(whole) || whole < 20000 || whole > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return day <= 12 ? iso(y, day, m) : iso(y, m, day);
  }
  const s = String(v).trim();
  if (!s) return null;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (dmy) {
    if (Number(dmy[3]) === 0 || Number(dmy[2]) === 0 || Number(dmy[1]) === 0) return null; // 00.00.0000
    return iso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sheet layout

const JUNK_LABEL = /^(TYPE OF CURRE|SURAT CLAI)/; // filler text SAP puts in the banner columns of the main header row

interface Layout {
  parts: string[][]; // per column: its header parts, top to bottom
  joined: string[]; // per column: parts joined by a space
}

const BANNERS = {
  kontrak: ['MUTU KONTRAK'],
  netto: ['NETTO'],
  klaim: ['MUTU KLAIM', 'MUTU CLAIM'],
  yield: ['YIELD'],
  diajukan: ['JLH CLAIM DIAJUKAN', 'JUMLAH CLAIM DIAJUKAN'],
  disetujui: ['JUMLAH CLAIM DISETUJUI', 'JLH CLAIM DISETUJUI'],
};

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if ((rows[i] || []).some((c) => normClaimDataHeader(c) === 'VENDOR CODE')) return i;
  }
  return -1;
}

function layoutOf(rows: unknown[][], from: number, to: number): Layout {
  const width = Math.max(...rows.slice(from, to + 1).map((r) => (r || []).length), 0);
  const parts: string[][] = [];
  const joined: string[] = [];
  for (let c = 0; c < width; c++) {
    const p: string[] = [];
    for (let r = from; r <= to; r++) {
      const v = normClaimDataHeader((rows[r] || [])[c]);
      if (v && !JUNK_LABEL.test(v)) p.push(v);
    }
    parts.push(p);
    joined.push(p.join(' '));
  }
  return { parts, joined };
}

/** First column (at or after `from`, before `to`) whose joined label or first part is one of `names`. */
function findCol(layout: Layout, names: string[], from = 0, to = Infinity): number {
  for (let c = from; c < Math.min(layout.joined.length, to); c++) {
    if (names.includes(layout.joined[c]) || (layout.parts[c].length > 0 && names.includes(layout.parts[c][0]))) return c;
  }
  return -1;
}

function findColRe(layout: Layout, re: RegExp, from = 0, to = Infinity): number {
  for (let c = from; c < Math.min(layout.joined.length, to); c++) if (re.test(layout.joined[c])) return c;
  return -1;
}

function bannerCol(rows: unknown[][], hdr: number, names: string[]): number {
  for (const r of [hdr - 1, hdr]) {
    if (r < 0) continue;
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) if (names.includes(normClaimDataHeader(row[c]))) return c;
  }
  return -1;
}

function mutuCols(layout: Layout, from: number, to: number): Record<keyof ClaimDataMutu, number> {
  const find = (prefix: string) => {
    for (let c = Math.max(0, from); c < Math.min(layout.joined.length, to); c++) {
      if (layout.joined[c].startsWith(prefix)) return c;
    }
    return -1;
  };
  return { ffa: find('FFA'), mi: find('M&I'), dns: find('DNS'), dobi: find('DOBI') };
}

const isCrValue = (v: unknown) => (typeof v === 'number' && v > 0) || (typeof v === 'string' && /^\d{6,}$/.test(v.trim()));

const idText = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : String(v);
  return text(v);
};

// ---------------------------------------------------------------------------------------------
// Parser

interface SheetColumns {
  c: Record<string, number>;
  kontrak: Record<keyof ClaimDataMutu, number>;
  klaim: Record<keyof ClaimDataMutu, number>;
  qty: number;
  qtySubmitted: number;
  uom: number;
  amt: number; // AMOUNT BEFORE TAX (IDR); tax = +1, after = +2
}

function resolveColumns(kind: ClaimDataKind, rows: unknown[][], hdr: number, layout: Layout): { cols?: SheetColumns; missing: string[] } {
  const c: Record<string, number> = {
    vendorCode: findCol(layout, ['VENDOR CODE']),
    vendorName: findCol(layout, ['VENDOR NAME', 'VENDOR DESCRIPTION']),
    groupOfVendor: findCol(layout, ['GROUP OF VENDOR']),
    groupKey: findCol(layout, ['GROUP KEY']),
    vendorType: findCol(layout, ['VENDOR TYPE']),
    cargoSource: findCol(layout, ['CARGO SOURCE']),
    traders: findCol(layout, ['TRADERS']),
    kebun: findCol(layout, ['KEBUN']),
    createdBy: findCol(layout, ['CREATED BY']),
    sta: findCol(layout, ['STA CLA', 'STA']),
    crNo: findCol(layout, ['CR NO', 'NO CR', 'CRNO']),
    crDate: findCol(layout, ['CR DATE', 'CLAIM DATE']),
    cmNo: findCol(layout, ['CM NO']),
    cmDate: findCol(layout, ['CM DATE']),
    poCnDate: findCol(layout, ['PO CN DATE']),
    osDays: findCol(layout, ['OUTSTANDING DAYS', 'OS DAYS', 'OUTSTANDING']),
    dest: findCol(layout, ['DEST']),
    poNumber: findCol(layout, ['NO PO']),
    contractExtNo: findCol(layout, ['NO KONTRAK']),
    comm: findCol(layout, ['COMM']),
    commodity: findCol(layout, ['COMMODITY']),
    materialDescription: findCol(layout, ['MATERIAL DESCRIPTION']),
    companyCode: findCol(layout, ['COMPA CODE', 'COMPANY CODE', 'CODE']),
    keterangan: findCol(layout, ['KETERANGAN']),
    typeClaim: findCol(layout, ['TYPE CLAIM', 'TYPE OF CLAIM']),
  };
  const kontrakStart = bannerCol(rows, hdr, BANNERS.kontrak);
  const nettoStart = bannerCol(rows, hdr, BANNERS.netto);
  const klaimStart = bannerCol(rows, hdr, BANNERS.klaim);
  const yieldStart = bannerCol(rows, hdr, BANNERS.yield);
  const diajukan = bannerCol(rows, hdr, BANNERS.diajukan);
  const disetujui = bannerCol(rows, hdr, BANNERS.disetujui);

  const missing: string[] = [];
  if (c.vendorCode < 0) missing.push('VENDOR CODE');
  if (c.crNo < 0) missing.push('CR NO');
  if (c.crDate < 0) missing.push('CR DATE');
  if (c.typeClaim < 0) missing.push('TYPE CLAIM');
  if (c.poNumber < 0) missing.push('NO PO');
  if (c.commodity < 0) missing.push('COMMODITY');
  if (kind === 'os' && c.osDays < 0) missing.push('OUTSTANDING DAYS');

  const klaimEnd = Math.min(...[yieldStart, c.typeClaim].filter((x) => x > 0), layout.joined.length);
  const kontrak = mutuCols(layout, Math.max(kontrakStart, 0), nettoStart >= 0 ? nettoStart : klaimStart >= 0 ? klaimStart : 0);
  const klaim = mutuCols(layout, klaimStart, klaimEnd);

  // Amount block: OS has one (diajukan); Real has two, submitted then approved - take approved.
  const blockStart = kind === 'real' ? (disetujui >= 0 ? disetujui : diajukan >= 0 ? diajukan : c.typeClaim) : Math.max(c.typeClaim, 0);
  const qty = findCol(layout, ['QUANTITY', 'DIAJUKAN QUANTITY', 'DIAJUKAN', 'DISETUJUI QUANTITY'], blockStart);
  const qtySubmitted =
    kind === 'real' ? findCol(layout, ['QUANTITY', 'DIAJUKAN QUANTITY', 'DIAJUKAN'], diajukan >= 0 ? diajukan : c.typeClaim) : -1;
  const amt = findColRe(layout, /BEFORE TAX.*IDR/, blockStart);
  if (qty < 0) missing.push('QUANTITY');
  if (amt < 0 || !/AFTER TAX.*IDR/.test(layout.joined[amt + 2] ?? '')) missing.push('AMOUNT (IDR)');
  const uom = qty >= 0 && /UOM/.test(layout.joined[qty + 1] ?? '') ? qty + 1 : -1;

  if (missing.length) return { missing };
  return { cols: { c, kontrak, klaim, qty, qtySubmitted, uom, amt }, missing: [] };
}

const MUTU_ZERO = (): ClaimDataMutu => ({ ffa: null, mi: null, dns: null, dobi: null });

export function parseClaimDataWorkbook(wb: XLSX.WorkBook, kind: ClaimDataKind): ClaimDataParseResult {
  const result: ClaimDataParseResult = {
    kind,
    rows: [],
    errors: [],
    warnings: [],
    sheetsRead: 0,
    sheetsSkipped: [],
    subtotalRowsSkipped: 0,
    reportedTotals: null,
    rowTotals: { qty: 0, amountAfterTax: 0 },
  };
  const seen = new Map<string, number>();
  let dupes = 0;
  let noCr = 0;
  let badType = 0;
  const reported = { qty: 0, amountAfterTax: 0 };
  let sawGrand = false;
  const sheetProblems: string[] = [];
  let prev: { cols: SheetColumns; layout: Layout } | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) {
      result.sheetsSkipped.push(sheetName);
      continue;
    }
    const origin = XLSX.utils.decode_range(ws['!ref']).s.r;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true, raw: true }) as unknown[][];
    const hdr = findHeaderRow(rows);
    let cols: SheetColumns;
    let layout: Layout;
    let dataStart: number;
    if (hdr < 0) {
      // A page without its own header block continues the previous page's layout.
      if (!prev) {
        result.sheetsSkipped.push(sheetName);
        continue;
      }
      ({ cols, layout } = prev);
      dataStart = 0;
    } else {
      // Header block ends at the first row below the header whose CR column holds a claim number.
      const crProbe = (() => {
        const row = rows[hdr] || [];
        for (let c = 0; c < row.length; c++) if (['CR NO', 'NO CR', 'CRNO'].includes(normClaimDataHeader(row[c]))) return c;
        return -1;
      })();
      dataStart = -1;
      if (crProbe >= 0) {
        for (let i = hdr + 1; i < Math.min(rows.length, hdr + 8); i++) {
          if (isCrValue((rows[i] || [])[crProbe])) {
            dataStart = i;
            break;
          }
        }
      }
      if (dataStart < 0) {
        // A header-only page (no claims): nothing to read, and no layout to learn from a half block.
        dataStart = Math.min(rows.length, hdr + 3);
      }
      layout = layoutOf(rows, hdr, Math.max(hdr, dataStart - 1));
      const resolved = resolveColumns(kind, rows, hdr, layout);
      if (!resolved.cols) {
        sheetProblems.push(`${sheetName}: missing ${resolved.missing.join(', ')}`);
        continue;
      }
      cols = resolved.cols;
      prev = { cols, layout };
    }
    const { c, kontrak, klaim, qty, qtySubmitted, uom, amt } = cols;
    result.sheetsRead++;

    const at = (row: unknown[], col: number) => (col >= 0 ? row[col] : null);
    const rawLabels = layout.joined.map((j, i) => j || `COL ${i}`);

    let vendorCode: string | null = null;
    let vendorName: string | null = null;

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every((x) => x == null || String(x).trim() === '')) continue;

      // SUB TOTAL / GRANDTOTAL rows carry their label in one of the first vendor columns.
      const label = [row[0], row[1], row[2], row[3]].map(normClaimDataHeader).join(' ');
      if (/(GRAND ?TOTAL|SUB ?TOTAL)/.test(label)) {
        if (/GRAND ?TOTAL/.test(label)) {
          sawGrand = true;
          reported.qty += num(row[qty]) ?? 0;
          reported.amountAfterTax += num(row[amt + 2]) ?? 0;
        } else {
          result.subtotalRowsSkipped++;
        }
        continue;
      }
      const codeRaw = normClaimDataHeader(at(row, c.vendorCode));
      const crLabel = layout.joined[c.crNo];
      if (codeRaw === 'VENDOR CODE' || (crLabel && normClaimDataHeader(at(row, c.crNo)) === crLabel)) continue; // repeated header

      const code = text(at(row, c.vendorCode));
      if (code) {
        vendorCode = code;
        vendorName = text(at(row, c.vendorName));
      }
      const crCell = at(row, c.crNo);
      if (!isCrValue(crCell)) {
        if (code) noCr++;
        continue;
      }
      const crNo = String(typeof crCell === 'number' ? Math.trunc(crCell) : String(crCell).trim());

      const typeRaw = text(at(row, c.typeClaim));
      const typeUp = typeRaw ? typeRaw.toUpperCase() : null;
      const claimType: ClaimDataClaimType | null = typeUp === 'MUTU' || typeUp === 'SUSUT' ? typeUp : null;
      if (!claimType) {
        badType++;
        continue;
      }

      const ket = text(at(row, c.keterangan));
      const prefix = ket && ket.includes('//') ? ket.split('//')[0].trim().toUpperCase() : null;
      const mutu = (cols: Record<keyof ClaimDataMutu, number>): ClaimDataMutu => {
        const m = MUTU_ZERO();
        (Object.keys(m) as Array<keyof ClaimDataMutu>).forEach((k) => {
          m[k] = cols[k] >= 0 ? num(row[cols[k]]) : null;
        });
        return m;
      };
      const raw: Record<string, unknown> = {};
      rawLabels.forEach((l, col) => {
        const v = row[col];
        if (v == null || v === '') return;
        const key = l in raw ? `${l} #${col}` : l;
        raw[key] = typeof v === 'string' ? decodeClaimDataEntities(v).trim() : v;
      });
      const osDays = num(at(row, c.osDays));
      const amountAfterTax = num(row[amt + 2]);
      const rec: ClaimDataRow = {
        kind,
        sheetName,
        sheetRow: origin + i + 1,
        claimType,
        typeRaw,
        vendorCode,
        vendorName: vendorName ?? text(at(row, c.vendorName)),
        groupOfVendor: text(at(row, c.groupOfVendor)),
        groupKey: text(at(row, c.groupKey)),
        vendorType: text(at(row, c.vendorType)),
        cargoSource: text(at(row, c.cargoSource)),
        traders: text(at(row, c.traders)),
        kebun: text(at(row, c.kebun)),
        createdBy: text(at(row, c.createdBy)),
        sta: text(at(row, c.sta)),
        crNo,
        crDate: parseClaimDataDate(at(row, c.crDate)),
        cmNo: idText(at(row, c.cmNo)),
        cmDate: parseClaimDataDate(at(row, c.cmDate)),
        poCnDate: parseClaimDataDate(at(row, c.poCnDate)),
        osDaysFile: osDays == null ? null : Math.trunc(osDays),
        dest: text(at(row, c.dest)),
        poNumber: idText(at(row, c.poNumber)),
        contractExtNo: kind === 'os' ? text(at(row, c.contractExtNo)) : null, // Real's NO KONTRAK is a different, numeric key
        comm: text(at(row, c.comm)),
        commodity: text(at(row, c.commodity)),
        materialDescription: text(at(row, c.materialDescription)),
        companyCode: text(at(row, c.companyCode)),
        currency: 'IDR',
        uom: uom >= 0 ? text(row[uom]) : null,
        keterangan: ket,
        transportGroup: prefix && prefix.length <= 40 ? prefix : null,
        mutuKontrak: mutu(kontrak),
        mutuKlaim: mutu(klaim),
        qty: num(row[qty]),
        qtySubmitted: qtySubmitted >= 0 ? num(row[qtySubmitted]) : null,
        amountBeforeTax: num(row[amt]),
        tax: num(row[amt + 1]),
        amountAfterTax,
        raw,
      };
      const prev = seen.get(`${claimType}|${crNo}`);
      if (prev !== undefined) {
        // Same CR twice in one file: keep the later one, never double count.
        const old = result.rows[prev];
        result.rowTotals.qty -= old.qty ?? 0;
        result.rowTotals.amountAfterTax -= old.amountAfterTax ?? 0;
        result.rows[prev] = rec;
        dupes++;
      } else {
        seen.set(`${claimType}|${crNo}`, result.rows.length);
        result.rows.push(rec);
      }
      result.rowTotals.qty += rec.qty ?? 0;
      result.rowTotals.amountAfterTax += rec.amountAfterTax ?? 0;
    }
  }

  if (result.sheetsRead === 0) {
    result.errors.push(
      sheetProblems.length
        ? `No sheet could be read. ${sheetProblems.slice(0, 3).join('; ')}`
        : 'No claim sheet found (no header row with VENDOR CODE).',
    );
  } else if (sheetProblems.length) {
    result.warnings.push(`${sheetProblems.length} sheet(s) skipped: ${sheetProblems.slice(0, 3).join('; ')}`);
  }
  if (result.rows.length === 0 && result.errors.length === 0) result.errors.push('The file has no claim rows.');
  if (dupes > 0) result.warnings.push(`${dupes} claim(s) appear more than once in the file; the last occurrence was used.`);
  if (noCr > 0) result.warnings.push(`${noCr} row(s) with a vendor but no CR number were skipped.`);
  if (badType > 0) result.warnings.push(`${badType} row(s) with a TYPE CLAIM other than MUTU / SUSUT were skipped.`);
  if (sawGrand) {
    result.reportedTotals = reported;
    const base = Math.max(Math.abs(reported.qty), 1);
    if (Math.abs(reported.qty - result.rowTotals.qty) / base > 0.001) {
      result.warnings.push(
        `The file's GRAND TOTAL quantity (${Math.round(reported.qty).toLocaleString('en-US')}) differs from the sum of its claim rows (${Math.round(result.rowTotals.qty).toLocaleString('en-US')}). KLIP uses the rows.`,
      );
    }
  }
  return result;
}

/** Convenience for tests and scripts. */
export function parseClaimDataFile(path: string, kind: ClaimDataKind): ClaimDataParseResult {
  return parseClaimDataWorkbook(XLSX.readFile(path), kind);
}
