/**
 * Formatting rules of the KMAPS partner records (contract: KLIP-SHIPMENT-API.md, sections 2 and 5).
 */

/** Page stage codes and the text the Shipments page shows for them (frontend/src/lib/shipmentStatusDisplay.ts). */
export const STAGE_LABELS: Record<string, string> = {
  PLANNED: 'Planned',
  ARRIVED_LP: 'Arrived LP',
  BERTHED_LP: 'Berthed LP',
  LOADING: 'Loading',
  COMPLETED_LOADING: 'Completed Loading',
  SAILED: 'Sailed',
  ARRIVED_DP: 'Arrived DP',
  BERTHED_DP: 'Berthed DP',
  UNLOADING: 'Unloading',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Stages before completed or cancelled. A shipment in any of them is "active" (contract 4.2). */
export const ACTIVE_STAGES: readonly string[] = [
  'PLANNED',
  'ARRIVED_LP',
  'BERTHED_LP',
  'LOADING',
  'COMPLETED_LOADING',
  'SAILED',
  'ARRIVED_DP',
  'BERTHED_DP',
  'UNLOADING',
];

export function normalizeStage(raw: unknown): string {
  const stage = String(raw ?? '').trim().toUpperCase();
  return stage === 'CANCELED' ? 'CANCELLED' : stage;
}

export function isActiveStage(stage: string): boolean {
  return ACTIVE_STAGES.includes(stage);
}

/**
 * KLIP stores leg times as TIMESTAMP without a zone, entered in Jakarta time. The contract wants an explicit offset, and never a guess: these are WIB, so
 * `+07:00`. Input is `YYYY-MM-DDTHH:MM:SS` from to_char; anything else is null.
 */
export function wibIso(local: string | null | undefined): string | null {
  if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) return null;
  return `${local}.000+07:00`;
}

/** `T/C` and `V/C` (what KLIP holds) become `TC` and `VC`; blank and anything else (an incoterm such as CIF was found there) is null. */
export function mapCharterType(raw: unknown): 'TC' | 'VC' | null {
  const value = String(raw ?? '').trim().toUpperCase().replace(/[\s./-]/g, '');
  if (value === 'TC') return 'TC';
  if (value === 'VC') return 'VC';
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * A KLIP quantity in the contract's units (`MT` or `KL`). KLIP keeps quantities in kilograms (the JPS payload says so too); the unit column is free text, so a
 * kilogram or an unknown unit is divided by 1000, a metric ton is kept, and a kilolitre is kept as `KL`.
 */
export function toContractQuantity(
  value: unknown,
  unit: unknown,
): { quantity: number | null; unit: 'MT' | 'KL' } {
  const raw = value === null || value === undefined || value === '' ? null : Number(value);
  const u = String(unit ?? '').trim().toUpperCase();
  const isKl = /^(KL|KILOLIT)/.test(u);
  const isLitre = /^(L|LTR|LITRE|LITER)S?$/.test(u);
  const isMt = /^(MT|TON|TONS|TONNE|TONNES)$/.test(u);
  if (raw === null || !Number.isFinite(raw)) return { quantity: null, unit: isKl || isLitre ? 'KL' : 'MT' };
  if (isKl) return { quantity: round3(raw), unit: 'KL' };
  if (isLitre) return { quantity: round3(raw / 1000), unit: 'KL' };
  if (isMt) return { quantity: round3(raw), unit: 'MT' };
  return { quantity: round3(raw / 1000), unit: 'MT' };
}

/** A decimal column (pg returns text) as a JSON number, or null. Never 0 for "unknown". */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Keys sorted at every level, so the same record always serializes to the same text (the content hash depends on it). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
