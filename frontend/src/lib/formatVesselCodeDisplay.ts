/** Display official vessel code in UI; provisional internal codes show as "-". */
export function formatVesselCodeDisplay(code?: string | null): string {
  if (!code?.trim()) return '-';
  const upper = code.trim().toUpperCase();
  if (upper.startsWith('TMP-')) return '-';
  return upper;
}
