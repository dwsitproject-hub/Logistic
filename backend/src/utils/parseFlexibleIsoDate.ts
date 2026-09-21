/**
 * Parse Excel / SAP claim-sheet dates into ISO YYYY-MM-DD.
 * Handles Date objects, Excel serials, dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy, and yyyymmdd.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const YMD_COMPACT_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** Excel serials in this window map to ~1954–2119 (claim CR dates, not row indexes). */
const EXCEL_SERIAL_MIN = 20000;
const EXCEL_SERIAL_MAX = 80000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(year: number, month1Based: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month1Based) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month1Based < 1 || month1Based > 12) return null;
  if (day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month1Based - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month1Based - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month1Based)}-${pad2(day)}`;
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.trunc(serial);
  if (whole < EXCEL_SERIAL_MIN || whole > EXCEL_SERIAL_MAX) return null;
  const utc = Date.UTC(1899, 11, 30) + whole * 86_400_000;
  const d = new Date(utc);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function parseDateObject(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function parseFlexibleIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return parseDateObject(v);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const asYmd = YMD_COMPACT_RE.exec(String(Math.trunc(v)));
    if (asYmd) {
      const iso = toIso(Number(asYmd[1]), Number(asYmd[2]), Number(asYmd[3]));
      if (iso) return iso;
    }
    return excelSerialToIso(v);
  }

  const s = String(v).trim();
  if (!s) return null;

  const iso = ISO_DATE_RE.exec(s);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = DMY_RE.exec(s);
  if (dmy) return toIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const compact = YMD_COMPACT_RE.exec(s);
  if (compact) return toIso(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const asNumber = Number(s.replace(/,/g, ''));
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) {
    return excelSerialToIso(asNumber);
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parseDateObject(new Date(parsed));
  return null;
}
