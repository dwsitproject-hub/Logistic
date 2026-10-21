import {
  extractVesselHullKey,
  normalizeVesselName,
  shouldAutoMergeVesselNames,
} from './vesselNameNormalize';

export type VesselCodeSourceRow = {
  name: string;
  code: string;
};

export type JovinVesselMatchQuality = 'exact' | 'alias-group' | 'fuzzy' | 'unmatched';

export type JovinVesselMatch = {
  vesselCode: string;
  matchedName: string;
  matchSource: string;
  matchQuality: JovinVesselMatchQuality;
  matchNotes: string;
};

export type SapIdentity = {
  key: string;
  display: string;
};

export type JovinSapMappingRow = {
  rowSource: 'Jovin' | 'SAP only';
  /** Spreadsheet Source column: Jovin / Jovin, SAP / SAP */
  source: 'Jovin' | 'Jovin, SAP' | 'SAP';
  vesselName: string;
  vesselCode: string;
  matchQuality: JovinVesselMatchQuality;
  matchSource: string;
  matchedName: string;
  matchNotes: string;
  jovinFields: Record<string, unknown>;
};

const EXTRA_PREFIX_RE = /^(BG|MT|MV|TB|TK|KM|SPOB|KLM)\.?\s*/i;
const TYPE_PREFIX_CAPTURE_RE = /^(BG|MT|MV|TB|TK|KM|SPOB|KLM)\.?\s*(.*)$/i;

function stripTypePrefixes(raw: string): string {
  let s = String(raw ?? '').trim();
  for (let i = 0; i < 5; i += 1) {
    const next = s.replace(EXTRA_PREFIX_RE, '');
    if (next === s) break;
    s = next.trim();
  }
  return s;
}

/** Normalized key for a single name segment (never slash-canonicalize). */
export function normalizeJovinVesselKey(name: unknown): string {
  const segment = String(name ?? '').split(/\s*\/\s*/)[0] ?? '';
  return normalizeVesselName(stripTypePrefixes(segment));
}

export function splitVesselNameParts(name: unknown): string[] {
  return String(name ?? '')
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function vesselMatchKeys(name: unknown): string[] {
  const keys = new Set<string>();
  for (const part of splitVesselNameParts(name)) {
    const key = normalizeJovinVesselKey(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function nameFamilyKey(normalizedName: string): string {
  return normalizedName.replace(/\s+\d+$/, '').trim();
}

export function formatJovinStyleDisplay(part: unknown): string {
  const raw = String(part ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const m = raw.match(TYPE_PREFIX_CAPTURE_RE);
  if (m) {
    const rest = String(m[2] ?? '').trim().toUpperCase();
    return rest ? `${m[1].toUpperCase()}. ${rest}` : `${m[1].toUpperCase()}.`;
  }
  return raw.toUpperCase();
}

function hullFromCode(code: string): string | null {
  const m = String(code ?? '')
    .trim()
    .toUpperCase()
    .match(/(\d+)$/);
  if (!m) return null;
  return m[1].replace(/^0+/, '') || '0';
}

function uniqueCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function formatCodes(codes: string[]): string {
  return uniqueCodes(codes).join(', ');
}

export function isUsableVesselCode(code: unknown): boolean {
  const s = String(code ?? '').trim();
  if (!s) return false;
  const upper = s.toUpperCase();
  return upper !== '#N/A' && upper !== 'N/A';
}

/**
 * One SAP row → one vessel identity.
 * Companion tug (LUMINOR 10 / MAXIMUS 711): codes stay on the BG/MT side.
 * Same family, different hull (AS MARINA 9 / AS MARINA 12): pick the part whose hull
 * matches the code (else the TB/TK part) so tug codes are not dumped onto the barge.
 */
export function assignSapRowIdentity(name: unknown, code: unknown): SapIdentity | null {
  const rawName = String(name ?? '').trim();
  const rawCode = String(code ?? '').trim();
  if (!rawName || !isUsableVesselCode(rawCode)) return null;

  const parts = splitVesselNameParts(rawName);
  const parsed = parts.map((part) => {
    const key = normalizeJovinVesselKey(part);
    return {
      part,
      key,
      hull: extractVesselHullKey(key),
      family: nameFamilyKey(key),
      isSea: /^(BG|MT)\.?\s*/i.test(part),
      isTug: /^(TB|TK)\.?\s*/i.test(part),
    };
  }).filter((p) => p.key);

  if (parsed.length === 0) return null;
  if (parsed.length === 1) {
    return { key: parsed[0].key, display: formatJovinStyleDisplay(parsed[0].part) };
  }

  const families = new Set(parsed.map((p) => p.family));
  const hulls = new Set(parsed.map((p) => p.hull).filter((h): h is string => Boolean(h)));

  if (families.size > 1) {
    const sea = [...parsed].reverse().find((p) => p.isSea) || parsed[parsed.length - 1];
    return { key: sea.key, display: formatJovinStyleDisplay(sea.part) };
  }

  if (hulls.size > 1) {
    const codeHull = hullFromCode(rawCode);
    const byCode = parsed.find((p) => p.hull && p.hull === codeHull);
    if (byCode) return { key: byCode.key, display: formatJovinStyleDisplay(byCode.part) };
    const tug = parsed.find((p) => p.isTug) || parsed[0];
    return { key: tug.key, display: formatJovinStyleDisplay(tug.part) };
  }

  const sea = [...parsed].reverse().find((p) => p.isSea) || parsed[0];
  return { key: sea.key, display: formatJovinStyleDisplay(sea.part) };
}

type IndexedSap = VesselCodeSourceRow & { identity: SapIdentity };

function indexSapRows(rows: VesselCodeSourceRow[]): IndexedSap[] {
  const out: IndexedSap[] = [];
  for (const r of rows) {
    const identity = assignSapRowIdentity(r.name, r.code);
    if (!identity) continue;
    out.push({
      name: String(r.name).trim(),
      code: String(r.code).trim().toUpperCase(),
      identity,
    });
  }
  return out;
}

function pickDisplayName(identityKey: string, rows: IndexedSap[], fallbackDisplay: string): string {
  const standalone = rows.find((r) => !String(r.name).includes('/') && normalizeJovinVesselKey(r.name) === identityKey);
  if (standalone) return formatJovinStyleDisplay(standalone.name);
  const withPrefix = rows.find((r) => TYPE_PREFIX_CAPTURE_RE.test(r.identity.display));
  if (withPrefix) return withPrefix.identity.display;
  return fallbackDisplay || identityKey;
}

function matchFromIndexed(
  jovinName: unknown,
  sapIndexed: IndexedSap[],
  klipRows: VesselCodeSourceRow[],
): JovinVesselMatch & { contributing: IndexedSap[] } {
  const empty: JovinVesselMatch & { contributing: IndexedSap[] } = {
    vesselCode: '',
    matchedName: '',
    matchSource: '',
    matchQuality: 'unmatched',
    matchNotes: '',
    contributing: [],
  };

  const jovinKey = normalizeJovinVesselKey(jovinName);
  if (!jovinKey) return empty;

  let quality: JovinVesselMatchQuality = 'unmatched';
  const sourceParts: string[] = [];
  let contributing: IndexedSap[] = sapIndexed.filter((r) => r.identity.key === jovinKey);

  if (contributing.length > 0) {
    sourceParts.push('SAP');
    quality = uniqueCodes(contributing.map((r) => r.code)).length > 1 ? 'alias-group' : 'exact';
  } else {
    const fuzzyKeys = new Set<string>();
    for (const row of sapIndexed) {
      if (shouldAutoMergeVesselNames(jovinKey, row.identity.key)) fuzzyKeys.add(row.identity.key);
    }
    contributing = sapIndexed.filter((r) => fuzzyKeys.has(r.identity.key));
    if (contributing.length > 0) {
      sourceParts.push('SAP');
      quality = 'fuzzy';
    }
  }

  const klipHits = klipRows.filter((r) => {
    if (!isUsableVesselCode(r.code)) return false;
    const key = normalizeJovinVesselKey(r.name);
    return key === jovinKey || (quality === 'unmatched' && shouldAutoMergeVesselNames(jovinKey, key));
  });
  const haveCodes = new Set(uniqueCodes(contributing.map((r) => r.code)));
  const klipNew = klipHits.filter((r) => !haveCodes.has(String(r.code).trim().toUpperCase()));
  if (klipNew.length > 0) {
    sourceParts.push('KLIP');
    if (quality === 'unmatched') quality = klipNew.length > 1 ? 'alias-group' : 'exact';
  }

  const sapCodes = uniqueCodes(contributing.map((r) => r.code));
  const klipCodes = uniqueCodes(klipNew.map((r) => String(r.code)));
  const orderedCodes = uniqueCodes([...sapCodes, ...klipCodes]);
  if (orderedCodes.length === 0) return empty;
  if (orderedCodes.length > 1 && quality === 'exact') quality = 'alias-group';

  const names = [...new Set([...contributing.map((r) => r.name), ...klipNew.map((r) => String(r.name).trim())])];
  const notes = [
    ...contributing.map((r) => `${r.code}|${r.name}`),
    ...klipNew.map((r) => `${String(r.code).trim().toUpperCase()}|${String(r.name).trim()}`),
  ]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join('; ');

  return {
    vesselCode: formatCodes(orderedCodes),
    matchedName: names.join(' | '),
    matchSource: sourceParts.join('+'),
    matchQuality: quality,
    matchNotes: notes,
    contributing,
  };
}

export function matchJovinVesselCodes(
  jovinName: unknown,
  sapRows: VesselCodeSourceRow[],
  klipRows: VesselCodeSourceRow[] = [],
): JovinVesselMatch {
  const { contributing: _c, ...match } = matchFromIndexed(jovinName, indexSapRows(sapRows), klipRows);
  return match;
}

const JOVIN_HELPER_KEYS = new Set([
  'Matched Name',
  'Match Source',
  'Match Quality',
  'Match Notes',
  'Row Source',
  'Source',
]);

export function buildJovinSapMappingRows(
  jovinRows: Record<string, unknown>[],
  sapRows: VesselCodeSourceRow[],
  klipRows: VesselCodeSourceRow[] = [],
): JovinSapMappingRow[] {
  const sapIndexed = indexSapRows(sapRows);
  const consumedKeys = new Set<string>();
  const out: JovinSapMappingRow[] = [];

  for (const row of jovinRows) {
    const vesselName = String(row['Vessel Name'] ?? '').trim();
    if (!vesselName) continue;
    const match = matchFromIndexed(vesselName, sapIndexed, klipRows);
    const jovinKey = normalizeJovinVesselKey(vesselName);
    if (jovinKey && match.vesselCode) consumedKeys.add(jovinKey);
    for (const r of match.contributing) consumedKeys.add(r.identity.key);

    const jovinFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (JOVIN_HELPER_KEYS.has(k) || k.startsWith('__EMPTY')) continue;
      jovinFields[k] = v;
    }
    jovinFields['Vessel Name'] = vesselName;
    jovinFields['Vessel Code'] = match.vesselCode;

    out.push({
      rowSource: 'Jovin',
      source: match.matchSource.includes('SAP') ? 'Jovin, SAP' : 'Jovin',
      vesselName,
      vesselCode: match.vesselCode,
      matchQuality: match.matchQuality,
      matchSource: match.matchSource,
      matchedName: match.matchedName,
      matchNotes: match.matchNotes,
      jovinFields,
    });
  }

  const leftover = sapIndexed.filter((r) => !consumedKeys.has(r.identity.key));
  const byKey = new Map<string, IndexedSap[]>();
  for (const r of leftover) {
    const list = byKey.get(r.identity.key) || [];
    list.push(r);
    byKey.set(r.identity.key, list);
  }

  for (const [key, rows] of byKey) {
    const codes = uniqueCodes(rows.map((r) => r.code));
    if (codes.length === 0) continue;
    const display = pickDisplayName(key, rows, rows[0].identity.display);
    const names = [...new Set(rows.map((r) => r.name))];
    const notes = rows
      .map((r) => `${r.code}|${r.name}`)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join('; ');

    out.push({
      rowSource: 'SAP only',
      source: 'SAP',
      vesselName: display,
      vesselCode: formatCodes(codes),
      matchQuality: codes.length > 1 ? 'alias-group' : 'exact',
      matchSource: 'SAP',
      matchedName: names.join(' | '),
      matchNotes: notes,
      jovinFields: {
        'Vessel Name': display,
        'Vessel Code': formatCodes(codes),
      },
    });
  }

  return out;
}
