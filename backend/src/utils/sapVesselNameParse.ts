/**
 * What a SAP vessel name says: one vessel, or a tug and a barge ("TB. ARGO 10 / BG. SOLID 10"), with the names cleaned the way the Master Vessel
 * sheet is (docs/scripts/vessel_common.py, fix_vessel_name) and the cases a person has to look at flagged.
 *
 * Pure functions, no I/O: registerVesselFromSap (services) decides what to create from this and never parses a name itself, so a rule is written
 * once.
 *
 * Facts it encodes (Ryan, 2026-10-08 / 2026-10-15; docs in memory klip-vessel-pairs-tb-bg):
 *  - SAP puts a tug and a barge in ONE name under ONE vessel code; the barge can be on either side.
 *  - SAP cuts the name at 35 characters ("TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR"), so a name that long may be a stump.
 *  - TK. / TKG. (tongkang) are barges and become BG.; KLM. / KM. / MV. only get their space and are flagged (no rule decided); a prefix this file does
 *    not know (OB.) is not guessed at.
 *  - "BG. LUMINOR 6 V.03/22" is ONE vessel with a voyage number, not a pair; "BG.LUMINOR 9 V23/22 /TB.OPTIMUS 722" is a pair whose barge has one.
 *  - A pair side with no prefix at all takes the role the other side leaves (flagged: the prefix was added, not written by SAP).
 *  - A combo carries ONE code: it goes to the vessel whose name the code abbreviates, else to the BARGE (assignPairCode).
 */

export type VesselRole = 'TB' | 'BG';
export type VesselTypeFromPrefix = 'TUG BOAT' | 'BARGE' | 'TANKER' | 'SPOB';

/** Why a name needs a person to look at it. Machine-readable; the review tab words them. */
export type VesselNameFlag =
  | 'truncated' // 35 characters or more: SAP may have cut it
  | 'no_prefix' // a single vessel whose name carries no TB./BG./MT./SPOB.: role and type unknown
  | 'unknown_prefix' // a pair side with a prefix this file does not know (OB.) - taken as the barge
  | 'tug_inferred' // a pair side with no prefix, the other being a barge: it is the tug, TB. added
  | 'barge_inferred' // a pair side with no prefix, the other being a tug: it is the barge, BG. added
  | 'prefix_undecided' // KLM. / KM. / MV.: kept, spacing only
  | 'pair_roles_conflict' // both sides TB or both BG, or neither settles it
  | 'too_many_segments' // more than two "/" parts: not parsed as a pair
  | 'empty';

export interface ParsedVesselSegment {
  /** The text as SAP wrote it (trimmed, spaces collapsed). */
  raw: string;
  /** Cleaned: upper case, "XX. NAME" with the prefix settled. */
  name: string;
  /** The name without prefix and voyage number, upper case. */
  baseName: string;
  prefix: string | null;
  role: VesselRole | null;
  type: VesselTypeFromPrefix | null;
  /** A "XX." this file does not know (OB.): left in the name, never guessed at. */
  unknownPrefix: boolean;
}

export interface ParsedSapVesselName {
  raw: string;
  kind: 'single' | 'pair' | 'empty';
  segments: ParsedVesselSegment[];
  /** Set for kind 'pair'. */
  tug: ParsedVesselSegment | null;
  barge: ParsedVesselSegment | null;
  flags: VesselNameFlag[];
}

/** SAP cuts a vessel name at 35 characters. */
export const SAP_VESSEL_NAME_MAX_LENGTH = 35;

const KNOWN_PREFIX_RE = /^(BG|TB|MT|SPOB|TKG|TK|KLM|KM|MV)\b\s*\.?\s*/i;
const VOYAGE_RE = /\s+V\.?\s*\d+(?:\s*\/\s*\d+)?\s*$/i; // 'LUMINOR 9 V23', 'ALISHA V.06/24'
/** The same, anywhere before a separator: "BG.LUMINOR 9 V23/22 /TB.OPTIMUS 722" is a pair with a voyage on its barge. */
const VOYAGE_BEFORE_SEPARATOR_RE = /\s+V\.?\s*\d+(?:\s*\/\s*\d+)?(?=\s*(?:\/|$))/gi;
/** "OB. FT VI": letters and a dot that none of the known prefixes explains. */
const UNKNOWN_PREFIX_RE = /^[A-Z]{1,5}\.\s*\S/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Comparable form: upper-case letters and digits only. */
export function vesselKey(text: unknown): string {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseSegment(raw: string): { segment: ParsedVesselSegment; flags: VesselNameFlag[] } {
  const flags: VesselNameFlag[] = [];
  const text = collapse(raw);
  const match = KNOWN_PREFIX_RE.exec(text);
  let prefix: string | null = null;
  let rest = text;
  if (match) {
    prefix = match[1].toUpperCase();
    rest = text.slice(match[0].length).trim();
  }
  rest = collapse(rest.toUpperCase());

  let role: VesselRole | null = null;
  let type: VesselTypeFromPrefix | null = null;
  let finalPrefix = prefix;
  if (prefix === 'TB') {
    role = 'TB';
    type = 'TUG BOAT';
  } else if (prefix === 'BG') {
    role = 'BG';
    type = 'BARGE';
  } else if (prefix === 'TK' || prefix === 'TKG') {
    // tongkang: a barge; the earlier cleanup of the pair list wrote it BG.
    role = 'BG';
    type = 'BARGE';
    finalPrefix = 'BG';
  } else if (prefix === 'MT') {
    type = 'TANKER';
  } else if (prefix === 'SPOB') {
    type = 'SPOB';
  } else if (prefix === 'KLM' || prefix === 'KM' || prefix === 'MV') {
    flags.push('prefix_undecided');
  }

  const unknownPrefix = !prefix && UNKNOWN_PREFIX_RE.test(text);
  const name = finalPrefix ? `${finalPrefix}. ${rest}`.trim() : rest;
  const baseName = collapse(rest.replace(VOYAGE_RE, ''));
  return {
    segment: {
      raw: text,
      name: finalPrefix ? name : collapse(name.replace(VOYAGE_RE, '')),
      baseName,
      prefix: finalPrefix,
      role,
      type,
      unknownPrefix,
    },
    flags,
  };
}

export function parseSapVesselName(input: unknown): ParsedSapVesselName {
  const raw = collapse(String(input ?? ''));
  if (!raw) {
    return { raw: '', kind: 'empty', segments: [], tug: null, barge: null, flags: ['empty'] };
  }
  const flags: VesselNameFlag[] = [];
  if (raw.length >= SAP_VESSEL_NAME_MAX_LENGTH) flags.push('truncated');

  // a voyage number ("... V.03/22") carries a slash that is not a pair separator
  const withoutVoyage = raw.replace(VOYAGE_BEFORE_SEPARATOR_RE, '');
  const parts = withoutVoyage
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    const { segment, flags: segFlags } = parseSegment(withoutVoyage);
    flags.push(...segFlags);
    if (!segment.prefix) flags.push('no_prefix');
    return { raw, kind: 'single', segments: [segment], tug: null, barge: null, flags };
  }

  if (parts.length > 2) {
    const parsed = parts.map((p) => parseSegment(p));
    flags.push('too_many_segments');
    return { raw, kind: 'single', segments: parsed.map((p) => p.segment), tug: null, barge: null, flags };
  }

  const left = parseSegment(parts[0]);
  const right = parseSegment(parts[1]);
  flags.push(...left.flags, ...right.flags);

  const L = left.segment;
  const R = right.segment;
  // a side with no prefix at all (not an unknown "XX.") takes the role the other side leaves
  const bare = (x: ParsedVesselSegment) => !x.prefix && !x.unknownPrefix;
  const asBarge = (x: ParsedVesselSegment) => {
    x.prefix = 'BG';
    x.role = 'BG';
    x.type = 'BARGE';
    x.name = `BG. ${x.name}`;
  };
  const asTug = (x: ParsedVesselSegment) => {
    x.prefix = 'TB';
    x.role = 'TB';
    x.type = 'TUG BOAT';
    x.name = `TB. ${x.name}`;
  };

  let tug: ParsedVesselSegment | null = null;
  let barge: ParsedVesselSegment | null = null;
  if (L.role === 'TB' && R.role !== 'TB') {
    tug = L;
    barge = R;
  } else if (R.role === 'TB' && L.role !== 'TB') {
    tug = R;
    barge = L;
  } else if (L.role === 'BG' && R.role !== 'BG' && bare(R)) {
    barge = L;
    tug = R;
    asTug(tug);
    flags.push('tug_inferred');
  } else if (R.role === 'BG' && L.role !== 'BG' && bare(L)) {
    barge = R;
    tug = L;
    asTug(tug);
    flags.push('tug_inferred');
  } else {
    // both TB, both BG, or no side that settles it: the order is kept and a person decides
    flags.push('pair_roles_conflict');
    tug = L;
    barge = R;
  }
  if (barge && !flags.includes('pair_roles_conflict') && barge.role !== 'BG') {
    if (bare(barge)) {
      asBarge(barge);
      flags.push('barge_inferred');
    } else {
      flags.push('unknown_prefix');
    }
  }

  return { raw, kind: 'pair', segments: [L, R], tug, barge, flags };
}

/** Letters of `body` appear in `key` in order (an abbreviation: LUM5 in LUMINOR5). */
function isAbbreviationOf(body: string, key: string): boolean {
  if (body.length < 3) return false;
  let at = 0;
  for (const ch of body) {
    const found = key.indexOf(ch, at);
    if (found < 0) return false;
    at = found + 1;
  }
  return true;
}

/**
 * Which vessel of a SAP pair a vessel code belongs to (Ryan, 2026-10-15): the code goes to the vessel whose name the code abbreviates
 * (MMARINA11 -> TB. AS MARINA 11, MLUM5 -> BG. LUMINOR 5); a code built from BOTH names (MELIZ-ASL, MTEBAR58, MARGOSOLID, MBIMA2301), or one that
 * fits neither or both, goes to the BARGE. `ambiguous` is true when the code fits both names, so a person can check.
 */
export function assignPairCode(
  code: string,
  tugName: string,
  bargeName: string,
): { role: VesselRole; ambiguous: boolean } {
  const body = vesselKey(code).replace(/^M/, '');
  const tugKey = vesselKey(tugName.replace(/^TB\.?\s*/i, '').replace(VOYAGE_RE, ''));
  const bargeKey = vesselKey(bargeName.replace(/^(BG|TK|TKG)\.?\s*/i, '').replace(VOYAGE_RE, ''));
  const onTug = isAbbreviationOf(body, tugKey);
  const onBarge = isAbbreviationOf(body, bargeKey);
  if (onTug && !onBarge) return { role: 'TB', ambiguous: false };
  if (onBarge && !onTug) return { role: 'BG', ambiguous: false };
  return { role: 'BG', ambiguous: onTug && onBarge };
}
