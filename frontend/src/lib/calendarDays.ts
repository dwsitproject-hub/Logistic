/** Calendar-date helpers — Trade Cycle > 0 = Late, ≤ 0 = On Time. */

export function toCalendarDateKey(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (iso) return iso[1];
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export function isTradeCycleLate(tradeCycleDays: number | null | undefined): boolean {
  return typeof tradeCycleDays === 'number' && Number.isFinite(tradeCycleDays) && tradeCycleDays > 0;
}

export function isCompletionLateVsDue(dueEnd: unknown, completion: unknown): boolean | null {
  const dueKey = toCalendarDateKey(dueEnd);
  const completionKey = toCalendarDateKey(completion);
  if (!dueKey || !completionKey) return null;
  return dueKey < completionKey;
}

export function isDueDatePastToday(dueEnd: unknown, today: Date = new Date()): boolean {
  const dueKey = toCalendarDateKey(dueEnd);
  const todayKey = toCalendarDateKey(today);
  if (!dueKey || !todayKey) return false;
  return dueKey < todayKey;
}

export type LateIndicatorDisplay = { color: string; text: string };

const LATE_DISPLAY: LateIndicatorDisplay = { color: 'bg-red-100 text-red-800', text: 'Late' };
const ON_TIME_DISPLAY: LateIndicatorDisplay = { color: 'bg-green-100 text-green-800', text: 'On Time' };
const NA_DISPLAY: LateIndicatorDisplay = { color: 'bg-gray-100 text-gray-800', text: '-' };

/** Late indicator aligned with backend computeLateIndicator (actual → ETA → past due). */
export function computeLateIndicatorDisplay(
  deliveryEnd: unknown,
  actualCompletion: unknown,
  etaCompletion?: unknown,
): LateIndicatorDisplay {
  if (!deliveryEnd) return NA_DISPLAY;
  if (actualCompletion) {
    const late = isCompletionLateVsDue(deliveryEnd, actualCompletion);
    if (late === null) return NA_DISPLAY;
    return late ? LATE_DISPLAY : ON_TIME_DISPLAY;
  }
  if (etaCompletion) {
    const late = isCompletionLateVsDue(deliveryEnd, etaCompletion);
    if (late === null) return NA_DISPLAY;
    return late ? LATE_DISPLAY : ON_TIME_DISPLAY;
  }
  return isDueDatePastToday(deliveryEnd) ? LATE_DISPLAY : ON_TIME_DISPLAY;
}
