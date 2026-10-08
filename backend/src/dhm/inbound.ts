import { dhmRequest } from './client';
import { getDhmVesselTypeEnumValues } from './catalog';
import { dhmRecordCode } from './mapper';
import type { DhmInboundResult, DhmRecord, KlipVesselForDhm } from './types';
import { isTugVesselType, toDhmVesselPayload } from './mapper';

function asRecord(value: unknown): DhmRecord | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Partial<DhmRecord>;
  if (!rec.id || !rec.data || typeof rec.data !== 'object') return null;
  return {
    id: String(rec.id),
    version: Number(rec.version) || 1,
    isDeleted: Boolean(rec.isDeleted),
    data: rec.data as Record<string, unknown>,
    updatedAt: String(rec.updatedAt || ''),
  };
}

function parseInboundBody(status: number, data: unknown): DhmInboundResult {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const record = asRecord(body.record);
  const inboundStatus = String(body.status || '');
  const code = typeof body.code === 'string' ? body.code : dhmRecordCode(record);

  if (status === 409 && record) {
    return {
      ok: false,
      conflict: true,
      status: 'duplicate',
      code: code || undefined,
      inboundId: body.inboundId != null ? String(body.inboundId) : undefined,
      record,
    };
  }

  if ((status === 201 || status === 200) && record && (inboundStatus === 'created' || inboundStatus === 'updated' || inboundStatus === 'unchanged')) {
    return {
      ok: true,
      status: inboundStatus,
      code: code || '',
      inboundId: body.inboundId != null ? String(body.inboundId) : undefined,
      record,
    };
  }

  const unknown = Array.isArray(body.unknownKeys)
    ? body.unknownKeys.map((key) => String(key)).filter(Boolean).join(', ')
    : '';
  const error =
    typeof body.error === 'string'
      ? unknown
        ? `${body.error} (${unknown})`
        : body.error
      : `DHM inbound failed (${status})`;
  return { ok: false, conflict: false, httpStatus: status, error };
}

/**
 * Slugs KLIP may write to. Every master pushed from pushMaster.ts / pushCatalog.ts must be listed
 * here: a slug missing from this set is refused before any request leaves KLIP, with "Unknown DHM
 * slug". The Master Plant Sync button pushed 'plant' while it was not listed, and all 31 rows
 * failed that way (2026-10-01). inbound.test.ts fails when a pushed slug is not in this set.
 */
export const INBOUND_SLUGS = new Set([
  'vessel',
  'company',
  'organization',
  'site',
  'plant',
  'port_master',
  'commodity',
  'incoterm',
  'shipper',
  'external_party',
]);

export async function postInbound(slug: string, payload: Record<string, unknown>): Promise<DhmInboundResult> {
  if (!INBOUND_SLUGS.has(slug)) {
    return { ok: false, conflict: false, httpStatus: 400, error: 'Unknown DHM slug' };
  }
  const { status, data } = await dhmRequest({
    method: 'POST',
    url: `/v1/inbound/${slug}`,
    data: payload,
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export async function putInbound(
  slug: string,
  dhmCode: string,
  payload: Record<string, unknown>,
): Promise<DhmInboundResult> {
  if (!INBOUND_SLUGS.has(slug)) {
    return { ok: false, conflict: false, httpStatus: 400, error: 'Unknown DHM slug' };
  }
  const code = String(dhmCode).trim();
  const { status, data } = await dhmRequest({
    method: 'PUT',
    url: `/v1/inbound/${slug}/${encodeURIComponent(code)}`,
    data: payload,
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export async function postVesselInbound(row: KlipVesselForDhm): Promise<DhmInboundResult> {
  const vesselTypeEnum = isTugVesselType(row.vessel_type) ? await getDhmVesselTypeEnumValues() : null;
  const { status, data } = await dhmRequest({
    method: 'POST',
    url: '/v1/inbound/vessel',
    data: toDhmVesselPayload(row, { vesselTypeEnum }),
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export async function putVesselInbound(dhmCode: string, row: KlipVesselForDhm): Promise<DhmInboundResult> {
  const code = String(dhmCode).trim();
  const vesselTypeEnum = isTugVesselType(row.vessel_type) ? await getDhmVesselTypeEnumValues() : null;
  const { status, data } = await dhmRequest({
    method: 'PUT',
    url: `/v1/inbound/vessel/${encodeURIComponent(code)}`,
    data: toDhmVesselPayload(row, { code, vesselTypeEnum }),
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export { parseInboundBody };
