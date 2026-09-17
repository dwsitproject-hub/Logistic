export const UNPLANNED_PLANNING_FORWARD_MONTHS = 3;
/** @deprecated Window end is now today + UNPLANNED_PLANNING_FORWARD_MONTHS calendar months */
export const UNPLANNED_PLANNING_FORWARD_DAYS = 60;
/** @deprecated Unplanned window is now today … today + UNPLANNED_PLANNING_FORWARD_MONTHS months */
export const UNPLANNED_PLANNING_START_BUFFER_DAYS = 0;
/** @deprecated Unplanned window is now today … today + UNPLANNED_PLANNING_FORWARD_MONTHS months */
export const UNPLANNED_PLANNING_END_BUFFER_DAYS = UNPLANNED_PLANNING_FORWARD_DAYS;

function sliceIsoDate(value: unknown): string {
  if (value == null || String(value).trim() === '') return '';
  return String(value).trim().slice(0, 10);
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!parts) return isoDate;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayIsoDate(reference = new Date()): string {
  const yyyy = reference.getFullYear();
  const mm = String(reference.getMonth() + 1).padStart(2, '0');
  const dd = String(reference.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function shiftIsoDateByMonths(isoDate: string, months: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!parts) return isoDate;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveUnplannedPlanningEndIso(startIso: string): string {
  return shiftIsoDateByMonths(startIso, UNPLANNED_PLANNING_FORWARD_MONTHS);
}

/** Unplanned planning window: today … today + 3 calendar months (inclusive). */
export function resolveUnplannedPlanningWindow(
  _deliveryEndRaw?: unknown,
  referenceToday?: string,
): { startIso: string; endIso: string } | null {
  const today = sliceIsoDate(referenceToday ?? todayIsoDate());
  if (!today) return null;
  const startIso = today;
  const endIso = resolveUnplannedPlanningEndIso(today);
  if (startIso > endIso) return null;
  return { startIso, endIso };
}

export function isDateWithinUnplannedPlanningWindow(
  dateIso: string,
  _deliveryEndRaw?: unknown,
  referenceToday?: string,
): boolean {
  const window = resolveUnplannedPlanningWindow(undefined, referenceToday);
  if (!window) return false;
  return dateIso >= window.startIso && dateIso <= window.endIso;
}
