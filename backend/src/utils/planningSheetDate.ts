import * as XLSX from 'xlsx';
import { parsePlanningTemplateDateText } from './planningTemplateDateFormat';

/** True if cell is non-empty for row filtering (preserves Date / number from Excel). */
function cellHasValue(c: unknown): boolean {
  if (c === '' || c === null || c === undefined) return false;
  if (c instanceof Date) return !Number.isNaN(c.getTime());
  if (typeof c === 'number') return Number.isFinite(c);
  return String(c).trim() !== '';
}

/**
 * Reads first sheet as a matrix without coercing cells to string.
 * Use `raw: true` so date cells are usually Excel serial numbers (unambiguous calendar days).
 */
export function parsePlanningSheetToMatrix(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) {
    throw new Error('The file has no worksheets');
  }
  const ws = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];
  return matrix
    .map((row) => row.map((c) => (c === null || c === undefined ? '' : c)))
    .filter((row) => row.some((c) => cellHasValue(c)));
}

/** Read all worksheets from an Excel workbook buffer (for WB rekap multi-sheet files). */
export function parseWbRekapWorkbookSheetsFromBuffer(
  buffer: Buffer,
): Array<{ sheetName: string; matrix: unknown[][] }> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets: Array<{ sheetName: string; matrix: unknown[][] }> = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];
    const filtered = matrix
      .map((row) => row.map((c) => (c === null || c === undefined ? '' : c)))
      .filter((row) => row.some((c) => cellHasValue(c)));
    sheets.push({ sheetName, matrix: filtered });
  }
  return sheets;
}

/**
 * Narrow band so we do not treat trucking quantities (e.g. 100000) as Excel date serials.
 * Typical calendar serials for ~1970–2100 fall in this range.
 */
function isPlausibleExcelDateSerial(n: number): boolean {
  return Number.isFinite(n) && n > 20000 && n < 70000;
}

/** Excel serial → calendar YYYY-MM-DD using SheetJS (handles 1900 leap-year quirk correctly). */
function excelSerialToIso10(serial: number, date1904 = false): string | null {
  if (!isPlausibleExcelDateSerial(serial)) return null;
  const p = XLSX.SSF.parse_date_code(serial, date1904 ? { date1904: true } : undefined, false);
  if (!p || p.y == null || p.m == null || p.d == null) return null;
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** KLIP planning templates: day first, month second (Indonesia / DD/MM/YYYY). */
function parseDmySeparatorsToIso10(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(t);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const cal = new Date(yyyy, mm - 1, dd);
  if (cal.getFullYear() !== yyyy || cal.getMonth() !== mm - 1 || cal.getDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Normalize a planning cell value to YYYY-MM-DD.
 * - Excel serials: use SheetJS SSF (not a naive epoch) and ignore non-date magnitudes (quantities).
 * - Slash/dot/dash text: always DD/MM/YYYY (never `new Date("m/d/y")`, which is US MM/DD in V8).
 */
export function toIsoDate10FromCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return excelSerialToIso10(raw);
  }

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = raw.getMonth() + 1;
    const day = raw.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const s0 = String(raw).trim();
  if (!s0) return null;

  const planningDate = parsePlanningTemplateDateText(s0);
  if (planningDate) return planningDate;

  const dmy = parseDmySeparatorsToIso10(s0);
  if (dmy) return dmy;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s0);
  if (ymd) return s0.slice(0, 10);

  if (/^\d+(\.\d+)?$/.test(s0)) {
    const n = parseFloat(s0);
    return excelSerialToIso10(n);
  }

  // Last resort: English month strings ("Mon Apr 10 2026") — use local calendar, not UTC ISO.
  if (!/\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}/.test(s0)) {
    const parsed = new Date(s0);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = parsed.getMonth() + 1;
      const day = parsed.getDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}
