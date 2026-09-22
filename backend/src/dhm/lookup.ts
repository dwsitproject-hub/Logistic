import { dhmRequest } from './client';
import type { DhmRecord } from './types';

/** Read-only. 404 must not auto-insert. */
export async function lookupVesselByCode(code: string): Promise<DhmRecord | null> {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;
  const { status, data } = await dhmRequest<DhmRecord | { error?: string }>({
    method: 'GET',
    url: `/v1/lookup/vessel/${encodeURIComponent(trimmed)}`,
  });
  if (status === 404) return null;
  if (status !== 200 || !data || typeof data !== 'object' || !('id' in data)) return null;
  return data as DhmRecord;
}
