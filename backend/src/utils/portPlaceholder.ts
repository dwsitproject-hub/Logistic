/** Legacy KLIP generic labels — not real master port names. */
export function isGenericKlipPortPlaceholder(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /^Loading Port \d+$/i.test(text) || /^Discharge Port$/i.test(text);
}
