import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import { integrationEnv } from '../integrations/integrationEnv';
import { isKmapsEnabled } from './config';
import logger from '../utils/logger';

/**
 * "Open KMAPS on this shipment" (docs: KLIP-EMBED.md). KLIP calls no KMAPS API and sends no data: it only builds a URL that
 * KMAPS resolves itself, with the signed-in user's own KMAPS session. The identifiers are the ones KLIP already hands KMAPS in
 * `GET /api/partner/v1/shipments`: `op` is the opaque record id (`id`), `sto` is `stoNumber`, `shipment` is `shipmentNo`, `vessel`
 * is the DHM vessel code. KMAPS tries them in that order, so every one we have is sent.
 */

const MAX_PARAM_LENGTH = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface KmapsEmbedIdentifiers {
  op?: string | null;
  sto?: string | null;
  shipment?: string | null;
  vessel?: string | null;
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s !== '' && s.length <= MAX_PARAM_LENGTH ? s : null;
};

/** The KMAPS origin to frame, from the saved Integrations > KMAPS setting (or .env). Null when absent or not an http(s) URL. */
export function kmapsEmbedBase(raw: string | undefined | null): URL | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * `<origin>/?embed=1&op=..&sto=..&shipment=..&vessel=..` - root path and query parameters only (no hash), values trimmed and URL-encoded,
 * at most 64 characters each (a longer one is dropped rather than cut). Null when there is no base or no identifier at all.
 */
export function buildKmapsEmbedUrl(base: URL | null, ids: KmapsEmbedIdentifiers): string | null {
  if (!base) return null;
  const op = clean(ids.op);
  const sto = clean(ids.sto);
  const shipment = clean(ids.shipment);
  if (!op && !sto && !shipment) return null;
  const params: Array<[string, string]> = [['embed', '1']];
  if (op) params.push(['op', op]);
  if (sto) params.push(['sto', sto]);
  if (shipment) params.push(['shipment', shipment]);
  const vessel = clean(ids.vessel);
  if (vessel) params.push(['vessel', vessel]);
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${base.origin}/?${query}`;
}

interface RecordRow {
  record_id: string;
  vessel_dhm_code: string | null;
  shipment_no: string | null;
  sto_number: string | null;
}

/**
 * GET /api/shipments/kmaps-status - is the KMAPS integration switched on (Integrations > KMAPS > Enabled)? The Shipments table shows the KMAPS icon
 * in its Action column only then; while it is off the column keeps the View Documents button. Read per request, so the switch takes effect at once.
 */
export const getKmapsEmbedStatus = (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { enabled: isKmapsEnabled() } });
};

/**
 * GET /api/shipments/kmaps-link?stoKey=&id=&sto=&shipment=
 *
 * `stoKey` / `id` locate the stored partner record (the same row KMAPS reads as `id`): by STO key, else by a member shipment id. What the
 * record does not have (a shipment that is not eligible for KMAPS yet, so has no record) is filled from `sto` / `shipment`, so KMAPS still
 * gets something to look up and shows its own "not found" state.
 */
export const getKmapsEmbedLink = async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, unknown>;
    if (!isKmapsEnabled()) {
      return res.json({ success: true, data: { enabled: false, url: null, reason: 'The KMAPS integration is switched off.' } });
    }
    const base = kmapsEmbedBase(integrationEnv('KMAPS_EMBED_URL'));
    if (!base) {
      return res.json({
        success: true,
        data: { enabled: false, url: null, reason: 'KMAPS_EMBED_URL is not set (Integrations > KMAPS).' },
      });
    }

    const stoKey = clean(q.stoKey);
    const idRaw = String(q.id ?? '').trim();
    const memberId = UUID_RE.test(idRaw) ? idRaw : null;

    let record: RecordRow | null = null;
    if (stoKey || memberId) {
      const found = await query(
        `SELECT record_id, vessel_dhm_code,
                payload->>'shipmentNo' AS shipment_no,
                payload->>'stoNumber'  AS sto_number
           FROM partner_shipment_records
          WHERE NOT deleted
            AND (($1::text IS NOT NULL AND sto_key = $1::text)
              OR ($2::uuid IS NOT NULL AND $2::uuid = ANY(member_ids)))
          ORDER BY (sto_key IS NOT DISTINCT FROM $1::text) DESC, active DESC, updated_at DESC
          LIMIT 1`,
        [stoKey, memberId],
      );
      record = (found.rows[0] as RecordRow | undefined) ?? null;
    }

    const stoHint = clean(q.sto) ?? stoKey;
    const url = buildKmapsEmbedUrl(base, {
      op: record?.record_id ?? null,
      sto: clean(record?.sto_number) ?? (stoHint && /^\d+$/.test(stoHint) ? stoHint : null),
      shipment: clean(record?.shipment_no) ?? clean(q.shipment),
      vessel: record?.vessel_dhm_code ?? null,
    });

    if (!url) {
      return res.json({ success: true, data: { enabled: true, url: null, reason: 'This row has no shipment identifier KMAPS can look up.' } });
    }
    return res.json({ success: true, data: { enabled: true, url, origin: base.origin, hasRecord: record !== null } });
  } catch (error) {
    logger.error('KMAPS embed link failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to build the KMAPS link' } });
  }
};
