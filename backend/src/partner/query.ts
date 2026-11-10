import { PARTNER_MAX_CODES, PARTNER_MAX_PAGE } from './catalog';

/**
 * Query parameters of GET /shipments (contract 4.1), parsed and checked. Pure, so every rule has a unit test.
 *
 * Reading mode:
 *   vessel       vesselCode and/or sapCode given: the complete answer for those vessels (4.4)
 *   full         neither a cursor nor updatedSince: active shipments only
 *   incremental  updatedSince or cursor: active shipments plus those that left the active set in the last 14 days
 * A cursor carries its mode, so a page after the first reads the same set the first one did whatever else the caller repeats.
 */
export type ReadMode = 'vessel' | 'full' | 'incremental';

export interface ParsedShipmentsQuery {
  limit: number;
  mode: ReadMode;
  updatedSince: string | null;
  after: { updatedAt: string; recordId: string } | null;
  vesselCodes: string[];
  sapCodes: string[];
  includeDeleted: boolean;
}

export class PartnerQueryError extends Error {}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? (v[0] === undefined ? undefined : String(v[0])) : v === undefined ? undefined : String(v));

/** `a,b , c` -> ['a','b','c'], blanks dropped, duplicates dropped. More than the maximum is an error, not a silent cut. */
export function parseCodeList(raw: unknown, name: string): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : raw === undefined ? '' : String(raw);
  const codes = [...new Set(text.split(',').map((c) => c.trim()).filter((c) => c !== ''))];
  if (codes.length > PARTNER_MAX_CODES) throw new PartnerQueryError(`${name} accepts at most ${PARTNER_MAX_CODES} codes`);
  return codes;
}

export function encodeCursor(mode: ReadMode, updatedAt: string, recordId: string): string {
  return Buffer.from(JSON.stringify({ m: mode, t: updatedAt, i: recordId }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { mode: ReadMode; updatedAt: string; recordId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { m?: string; t?: string; i?: string };
    if ((parsed.m !== 'vessel' && parsed.m !== 'full' && parsed.m !== 'incremental') || !parsed.t || !parsed.i) throw new Error('shape');
    if (Number.isNaN(Date.parse(parsed.t))) throw new Error('time');
    return { mode: parsed.m, updatedAt: parsed.t, recordId: parsed.i };
  } catch {
    throw new PartnerQueryError('cursor is not valid');
  }
}

export function parseShipmentsQuery(query: Record<string, unknown>): ParsedShipmentsQuery {
  const limitRaw = first(query.limit);
  let limit = PARTNER_MAX_PAGE;
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > PARTNER_MAX_PAGE) {
      throw new PartnerQueryError(`limit must be a whole number from 1 to ${PARTNER_MAX_PAGE}`);
    }
    limit = Number(limitRaw);
  }

  const vesselCodes = parseCodeList(query.vesselCode, 'vesselCode');
  const sapCodes = parseCodeList(query.sapCode, 'sapCode').map((c) => c.toUpperCase());

  const updatedRaw = first(query.updatedSince);
  let updatedSince: string | null = null;
  if (updatedRaw !== undefined && updatedRaw !== '') {
    const t = Date.parse(updatedRaw);
    if (Number.isNaN(t)) throw new PartnerQueryError('updatedSince must be an ISO 8601 date-time');
    updatedSince = new Date(t).toISOString();
  }

  const cursorRaw = first(query.cursor);
  const decoded = cursorRaw ? decodeCursor(cursorRaw) : null;

  const includeRaw = first(query.includeDeleted);
  if (includeRaw !== undefined && includeRaw !== 'true' && includeRaw !== 'false') {
    throw new PartnerQueryError('includeDeleted must be true or false');
  }

  const hasVessels = vesselCodes.length > 0 || sapCodes.length > 0;
  const mode: ReadMode = decoded ? decoded.mode : hasVessels ? 'vessel' : updatedSince ? 'incremental' : 'full';
  if (decoded && decoded.mode === 'vessel' && !hasVessels) throw new PartnerQueryError('cursor does not belong to this request');

  return {
    limit,
    mode,
    // A cursor wins over updatedSince (contract 4.1).
    updatedSince: decoded ? null : updatedSince,
    after: decoded ? { updatedAt: decoded.updatedAt, recordId: decoded.recordId } : null,
    vesselCodes,
    sapCodes,
    includeDeleted: includeRaw === 'true',
  };
}
