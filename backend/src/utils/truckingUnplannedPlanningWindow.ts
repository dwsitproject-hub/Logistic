import { toIsoDate10FromCell } from './planningSheetDate';

export const UNPLANNED_PLANNING_START_BUFFER_DAYS = 15;
export const UNPLANNED_PLANNING_END_BUFFER_DAYS = 30;

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

/** Unplanned planning window: today −15 days … SAP due delivery end +30 days. */
export function resolveUnplannedPlanningWindow(
  deliveryEndRaw: unknown,
  referenceToday?: string,
): { startIso: string; endIso: string } | null {
  const endBase = toIsoDate10FromCell(deliveryEndRaw) ?? sliceIsoDate(deliveryEndRaw);
  if (!endBase) return null;
  const today = sliceIsoDate(referenceToday ?? todayIsoDate());
  if (!today) return null;
  const startIso = shiftIsoDate(today, -UNPLANNED_PLANNING_START_BUFFER_DAYS);
  const endIso = shiftIsoDate(endBase, UNPLANNED_PLANNING_END_BUFFER_DAYS);
  if (startIso > endIso) return null;
  return { startIso, endIso };
}

export function isDateWithinUnplannedPlanningWindow(
  dateIso: string,
  deliveryEndRaw: unknown,
  referenceToday?: string,
): boolean {
  const window = resolveUnplannedPlanningWindow(deliveryEndRaw, referenceToday);
  if (!window) return false;
  return dateIso >= window.startIso && dateIso <= window.endIso;
}
