/** PO-primary identity helpers for contracts / SAP import. */

const PLACEHOLDER_EXT_NOS = new Set(['', 'TBA', 'TBD', 'N/A', '-', 'NULL', 'NONE']);

export function normalizePoNumber(po: unknown): string | null {
  const s = String(po ?? '').trim();
  return s || null;
}

export function normalizeStoNumber(sto: unknown): string {
  return String(sto ?? '').trim();
}

export function isPlaceholderExtNo(ext: unknown): boolean {
  const s = String(ext ?? '').trim().toUpperCase();
  if (!s) return true;
  return PLACEHOLDER_EXT_NOS.has(s);
}

export function extractContractExtNoFromSpdJson(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const raw = d.raw as Record<string, unknown> | undefined;
  const fromRaw = raw?.['Contract Ext No'];
  const fromTop = d['Contract Ext No'];
  const ext = String(fromRaw ?? fromTop ?? '').trim();
  return ext || null;
}

export function poStoProcessedKey(po: unknown, sto: unknown): { po: string; sto: string } | null {
  const poNorm = normalizePoNumber(po);
  if (!poNorm) return null;
  return { po: poNorm, sto: normalizeStoNumber(sto) };
}

/** Prefer Open status, then most recently updated contract row. */
export function contractSurvivorScore(row: {
  status?: string | null;
  updated_at?: Date | string | null;
  created_at?: Date | string | null;
}): number {
  const status = String(row.status ?? '').trim().toLowerCase();
  const openBoost = status === 'open' || status === 'active' ? 1_000_000_000_000 : 0;
  const updated = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const created = row.created_at ? new Date(row.created_at).getTime() : 0;
  return openBoost + Math.max(updated, created);
}
