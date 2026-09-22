import { dhmRequest } from './client';
import { dhmRecordCode } from './mapper';
import type { DhmInboundResult, DhmRecord, KlipVesselForDhm } from './types';
import { toDhmVesselPayload } from './mapper';

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

  const error =
    typeof body.error === 'string'
      ? body.error
      : `DHM inbound failed (${status})`;
  return { ok: false, conflict: false, httpStatus: status, error };
}

export async function postVesselInbound(row: KlipVesselForDhm): Promise<DhmInboundResult> {
  const { status, data } = await dhmRequest({
    method: 'POST',
    url: '/v1/inbound/vessel',
    data: toDhmVesselPayload(row),
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export async function putVesselInbound(dhmCode: string, row: KlipVesselForDhm): Promise<DhmInboundResult> {
  const code = String(dhmCode).trim();
  const { status, data } = await dhmRequest({
    method: 'PUT',
    url: `/v1/inbound/vessel/${encodeURIComponent(code)}`,
    data: toDhmVesselPayload(row, { code }),
    headers: { 'Content-Type': 'application/json' },
  });
  return parseInboundBody(status, data);
}

export { parseInboundBody };
