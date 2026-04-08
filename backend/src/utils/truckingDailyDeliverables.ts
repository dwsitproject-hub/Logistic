type DailyDeliverableInputRow = {
  date?: unknown;
  quantity_delivered?: unknown;
};

export type NormalizedDailyDeliverableRow = {
  date: string; // YYYY-MM-DD
  quantity_delivered: number;
};

export function normalizeAndValidateDailyDeliverables(args: {
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
    return { ok: false, message: 'ETA Trucking Start/Last Receive Date are required when daily deliverables are provided' };
  }

  const maxQty =
    maxQtyRaw != null && String(maxQtyRaw).trim() !== '' && Number.isFinite(Number(maxQtyRaw))
      ? Number(maxQtyRaw)
      : null;

  const startS = String(startRaw).slice(0, 10);
  const endS = String(endRaw).slice(0, 10);

  const rows: NormalizedDailyDeliverableRow[] = [];
  let sum = 0;

  for (const [idx, row0] of (daily_deliverables as DailyDeliverableInputRow[]).entries()) {
    const row = row0 || {};
    const d = String(row?.date || '').trim();
    const qn = Number((row as any)?.quantity_delivered);

    if (!d) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: date is required` };
    }
    if (!Number.isFinite(qn) || qn < 0) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: quantity must be a valid number` };
    }

    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: invalid date` };
    }

    const ds = d.slice(0, 10);
    if (ds < startS) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: date cannot be before Trucking Start Receive Date` };
    }
    if (ds > endS) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: date cannot be after Trucking Last Receive Date` };
    }
    if (maxQty != null && qn > maxQty) {
      return { ok: false, message: `Daily deliverables row ${idx + 1}: quantity cannot exceed Quantity Delivered` };
    }

    sum += qn;
    rows.push({ date: ds, quantity_delivered: qn });
  }

  if (maxQty != null && sum > maxQty) {
    return { ok: false, message: 'Sum of daily deliverables quantity cannot exceed Quantity Delivered' };
  }

  return { ok: true, rows };
}

