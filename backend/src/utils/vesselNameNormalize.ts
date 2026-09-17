/** Normalize vessel name for cross-source matching (Jovin, KLIP sheet, SAP). */

const TYPE_PREFIX_RE = /^(BG|MT|TB|KLM|TK)\.?\s*/i;

const ROMAN_TO_ARABIC: Record<string, string> = {
  I: '1',
  II: '2',
  III: '3',
  IV: '4',
  V: '5',
  VI: '6',
  VII: '7',
  VIII: '8',
  IX: '9',
  X: '10',
  XI: '11',
  XII: '12',
  XIII: '13',
  XIV: '14',
  XV: '15',
};

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

  const seaSegments = segments.filter((s) => /^(BG|MT)\.?\s*/i.test(s));
  if (seaSegments.length > 0) {
    return seaSegments[seaSegments.length - 1].toUpperCase();
  }

  return segments[segments.length - 1].toUpperCase();
}

export function normalizeVesselName(name: unknown): string {
  const canonical = resolveCanonicalVesselDisplayName(name);
  let s = (canonical ?? String(name ?? '')).toUpperCase().trim();
  if (!s) return '';

  for (let i = 0; i < 5; i += 1) {
    const next = s.replace(TYPE_PREFIX_RE, '');
    if (next === s) break;
    s = next.trim();
  }

  s = s.replace(/[^A-Z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bSAMUDERA\b/g, 'SAMUDRA');

  const parts = s.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  if (ROMAN_TO_ARABIC[last]) {
    parts[parts.length - 1] = ROMAN_TO_ARABIC[last];
    s = parts.join(' ');
  }
  return s;
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

/** Trailing hull / sequence number after normalize (roman already converted). */
export function extractVesselHullKey(normalizedName: string): string | null {
  const m = normalizedName.trim().match(/(\d+)$/);
  if (!m) return null;
  return m[1].replace(/^0+/, '') || '0';
}

export function vesselNameTokens(normalizedName: string): string[] {
  return normalizedName
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== 'NO');
}

const NOISE_NAME_TOKENS = new Set(['AS', 'MV', 'KM', 'THE']);

function tokenSet(normalizedName: string): Set<string> {
  return new Set(vesselNameTokens(normalizedName));
}

/** True when every token of the shorter name appears in the longer name. */
export function isVesselNameTokenContained(a: string, b: string): boolean {
  const aTok = tokenSet(a);
  const bTok = tokenSet(b);
  const [shorter, longer] = aTok.size <= bTok.size ? [aTok, bTok] : [bTok, aTok];
  if (shorter.size === 0) return false;
  for (const t of shorter) {
    if (!longer.has(t)) return false;
  }
  return true;
}

/**
 * Token containment is only a safe merge when extra tokens are fleet/type noise
 * (e.g. AS GLORY 7 vs GLORY 7), not significant name parts (PRIMA SAMUDRA 9 vs SAMUDRA 9).
 */
export function isSafeNoiseTokenContainment(a: string, b: string): boolean {
  if (!isVesselNameTokenContained(a, b)) return false;
  const aTok = tokenSet(a);
  const bTok = tokenSet(b);
  const [shorter, longer] = aTok.size <= bTok.size ? [aTok, bTok] : [bTok, aTok];
  const extra = [...longer].filter((t) => !shorter.has(t));
  return extra.length > 0 && extra.every((t) => NOISE_NAME_TOKENS.has(t));
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** 0–1 similarity from Levenshtein (1 = identical). */
export function vesselNameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export const VESSEL_FUZZY_AUTO_MERGE_THRESHOLD = 0.9;

/**
 * Auto-merge only when hull numbers match AND (token containment or ≥90% similar).
 * Different hulls (LUMINOR 8 vs 9) never auto-merge.
 */
export function shouldAutoMergeVesselNames(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const hullA = extractVesselHullKey(normA);
  const hullB = extractVesselHullKey(normB);
  if (!hullA || !hullB || hullA !== hullB) return false;
  if (isSafeNoiseTokenContainment(normA, normB)) return true;
  return vesselNameSimilarity(normA, normB) >= VESSEL_FUZZY_AUTO_MERGE_THRESHOLD;
}

export function shouldReviewVesselNamePair(normA: string, normB: string): boolean {
  if (!normA || !normB || normA === normB) return false;
  if (shouldAutoMergeVesselNames(normA, normB)) return false;
  return vesselNameSimilarity(normA, normB) >= VESSEL_FUZZY_AUTO_MERGE_THRESHOLD;
}
