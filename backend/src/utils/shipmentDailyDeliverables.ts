type DailyDeliverableInputRow = {
  date?: unknown;
  quantity_delivered?: unknown;
};

export type NormalizedDailyDeliverableRow = {
  date: string; // YYYY-MM-DD
  quantity_delivered: number;
};

export function parseDailyDeliverableQuantity(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const cleaned = s.replace(/,/g, '').replace(/\s+/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function normalizeAndValidateShipmentDailyDeliverables(args: {
  daily_deliverables: unknown;
  startRaw: unknown;
  endRaw: unknown;
  maxQtyRaw: unknown;
}): { ok: true; rows: NormalizedDailyDeliverableRow[] } | { ok: false; message: string } {
  const { daily_deliverables, startRaw, endRaw, maxQtyRaw } = args;

  if (daily_deliverables == null) return { ok: true, rows: [] };
  if (!Array.isArray(daily_deliverables)) {
    return { ok: false, message: 'daily_deliverables must be an array' };
  }

  const start = startRaw ? new Date(String(startRaw)) : null;
  const end = endRaw ? new Date(String(endRaw)) : null;
  if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
    return { ok: false, message: 'Due Date Delivery Start/End are required when daily deliverables are provided' };
  }

  const maxQty =
    maxQtyRaw != null && String(maxQtyRaw).trim() !== '' && Number.isFinite(Number(maxQtyRaw))
      ? Number(maxQtyRaw)
      : null;

  const toIsoDate10 = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    if (!s) return null;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (ymd) return s.slice(0, 10);
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) {
      const dd = Number(dmy[1]);
      const mm = Number(dmy[2]);
      const yyyy = Number(dmy[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const cal = new Date(yyyy, mm - 1, dd);
        if (cal.getFullYear() === yyyy && cal.getMonth() === mm - 1 && cal.getDate() === dd) {
          return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
      }
      return null;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const startS = toIsoDate10(startRaw);
  const endS = toIsoDate10(endRaw);
  if (!startS || !endS) {
    return { ok: false, message: 'Due Date Delivery Start/End are required when daily deliverables are provided' };
  }
  if (startS > endS) {
    return {
      ok: false,
      message: `Due Start (${startS}) must be on or before Due End (${endS}).`,
    };
  }

  const rows: NormalizedDailyDeliverableRow[] = [];
  let sum = 0;

  for (const [idx, row0] of (daily_deliverables as DailyDeliverableInputRow[]).entries()) {
    const row = row0 || {};
    const d = String(row?.date || '').trim();
    const qn = parseDailyDeliverableQuantity((row as any)?.quantity_delivered);

    if (!d) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: date is required` };
    }
    if (qn === null || qn < 0) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: quantity must be a valid number` };
    }

    const ds = toIsoDate10(d);
    if (!ds) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: invalid date` };
    }
    // Inclusive window: Due Start ≤ date ≤ Due End
    if (ds < startS || ds > endS) {
      return {
        ok: false,
        message: `Daily deliverables row ${idx + 1}: date ${ds} must satisfy Due Start (${startS}) ≤ date ≤ Due End (${endS}) (inclusive).`,
      };
    }
    if (maxQty != null && qn > maxQty) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: quantity cannot exceed B/L Quantity` };
    }

    sum += qn;
    rows.push({ date: ds, quantity_delivered: qn });
  }

  if (maxQty != null && sum > maxQty) {
    return { ok: false, message: 'Sum of daily deliverables quantity cannot exceed B/L Quantity' };
  }

  return { ok: true, rows };
}

