/** Normalize vessel name for cross-source matching (Jovin, KLIP sheet, SAP). */
export function normalizeVesselName(name: unknown): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/^BG\.\s*/, '')
    .replace(/^MT\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMissingVesselCode(code: unknown): boolean {
  const s = String(code ?? '').trim();
  if (!s) return true;
  const upper = s.toUpperCase();
  return upper === '#N/A' || upper === 'N/A';
}

export function uppercaseText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.toUpperCase() : null;
}

/**
 * SAP often sends tug/barge pairs like "TB. AS MARINA 9 / BG. AS MARINA 12".
 * Display and master data should prefer the sea/barge segment (BG./MT.) over the compound string.
 */
export function resolveCanonicalVesselDisplayName(name: unknown): string | null {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  if (!raw.includes('/')) return raw.toUpperCase();

  const segments = raw
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  const seaSegments = segments.filter((s) => /^BG\.?\s/i.test(s) || /^MT\.?\s/i.test(s));
  if (seaSegments.length > 0) {
    return seaSegments[seaSegments.length - 1].toUpperCase();
  }

  return segments[segments.length - 1].toUpperCase();
}

/** Pick the better KLIP display name when merging master/SAP sources. */
export function pickPreferredVesselDisplayName(existing: string, incoming: string): string {
  const canonExisting = resolveCanonicalVesselDisplayName(existing);
  const canonIncoming = resolveCanonicalVesselDisplayName(incoming);
  if (!canonIncoming) return existing;
  if (!canonExisting) return canonIncoming;
  if (canonExisting === canonIncoming) return canonExisting;

  if (!existing.includes('/') && incoming.includes('/')) return existing.toUpperCase();
  if (existing.includes('/') && !incoming.includes('/')) return incoming.toUpperCase();

  return canonIncoming;
}
