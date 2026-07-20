/**
 * Calendar-date helpers aligned with PostgreSQL `date::date` subtraction.
 * Trade Cycle: completion_date - delivery_end_date
 *   > 0  → Late (completed after due)
 *   ≤ 0  → On Time (same day or ahead)
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalize any supported date input to YYYY-MM-DD. */
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

    const dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
    if (dmy) {
      const dd = dmy[1].padStart(2, '0');
      const mm = dmy[2].padStart(2, '0');
      return `${dmy[3]}-${mm}-${dd}`;
    }

    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/** Whole calendar days from start → end (end - start). */
export function diffCalendarDays(start: unknown, end: unknown): number | null {
  const startKey = toCalendarDateKey(start);
  const endKey = toCalendarDateKey(end);
  if (!startKey || !endKey) return null;

  const [y1, m1, d1] = startKey.split('-').map(Number);
  const [y2, m2, d2] = endKey.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_PER_DAY);
}

/** Trade Cycle > 0 = Late; ≤ 0 = On Time. */
export function isTradeCycleLate(tradeCycleDays: number | null | undefined): boolean {
  return typeof tradeCycleDays === 'number' && Number.isFinite(tradeCycleDays) && tradeCycleDays > 0;
}

/** Late when completion calendar date is strictly after due end date. Same day = on time. */
export function isCompletionLateVsDue(dueEnd: unknown, completion: unknown): boolean | null {
  const dueKey = toCalendarDateKey(dueEnd);
  const completionKey = toCalendarDateKey(completion);
  if (!dueKey || !completionKey) return null;
  return dueKey < completionKey;
}

/** Late indicator when no actual/ETA completion exists yet but due date is past today. */
export function isDueDatePastToday(dueEnd: unknown, today: Date = new Date()): boolean {
  const dueKey = toCalendarDateKey(dueEnd);
  const todayKey = toCalendarDateKey(today);
  if (!dueKey || !todayKey) return false;
  return dueKey < todayKey;
}

export function hasCalendarDate(value: unknown): boolean {
  return toCalendarDateKey(value) != null;
}

/**
 * Open drilldown Condition B (standard ETA empty): Trade Cycle = today − due date delivery end (calendar days).
 * Late when today > due end (Trade Cycle > 0); On Time when today ≤ due end (Trade Cycle ≤ 0).
 */
export function openDueDateTradeCycleDays(deliveryEnd: unknown, today: Date = new Date()): number | null {
  return diffCalendarDays(deliveryEnd, today);
}

/** @deprecated Use openDueDateTradeCycleDays — kept for callers comparing against planning/discharge ETA. */
export function openFallbackTradeCycleDays(fallbackDate: unknown, today: Date = new Date()): number | null {
  return diffCalendarDays(fallbackDate, today);
}

/** Condition B: On Time when today ≤ due date delivery end (Trade Cycle ≤ 0), including due today. */
export function isOpenConditionBOnTime(tradeCycleDays: number): boolean {
  return tradeCycleDays <= 0;
}

/** Condition A / legacy: On Time when Trade Cycle <= 0. */
export function isLegacyTradeCycleOnTime(tradeCycleDays: number): boolean {
  return tradeCycleDays <= 0;
}

/** On Time / Late / - — actual completion first, then ETA, then past-due fallback. */
export function computeLateIndicatorText(
  dueEnd: unknown,
  actualCompletion: unknown,
  etaCompletion?: unknown,
  today: Date = new Date(),
): string {
  if (!dueEnd) return '-';
  if (actualCompletion) {
    const late = isCompletionLateVsDue(dueEnd, actualCompletion);
    return late == null ? '-' : late ? 'Late' : 'On Time';
  }
  if (etaCompletion) {
    const late = isCompletionLateVsDue(dueEnd, etaCompletion);
    return late == null ? '-' : late ? 'Late' : 'On Time';
  }
  return isDueDatePastToday(dueEnd, today) ? 'Late' : 'On Time';
}
