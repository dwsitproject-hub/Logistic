/**
 * Collapse duplicate vessel loading ports when an STO group's shipments are read together.
 *
 * Background: a multi-PO / multi-contract STO has one shipment row per contract, and the SAP sync
 * writes vessel_loading_ports per shipment. Each row is legitimate on its own. But the Edit
 * Shipment modal and the vessel-loading-ports endpoint expand to the whole STO group, so the same
 * physical port arrives once per group member — which rendered as two "Loading Port 1" blocks in
 * sections 3, 4 and 5, the first one empty because only one member carried the ETA/ATA data.
 *
 * The rows are not corrupt, so the fix belongs here at the aggregation layer rather than in the
 * data. Within one (port_sequence, is_discharge_port) slot:
 *   - Rows naming the same real port collapse to the best-populated one.
 *   - A placeholder-named row ("Loading Port 1", "Discharge Port", or a stray bare number)
 *     collapses into a real-named row when one exists in the same slot.
 *   - Two genuinely different real ports in one slot are BOTH kept — measured at 33 slots in
 *     production, and dropping one would silently lose a real port call.
 */

/** Fields that carry no information about how populated a port row is. */
const NON_DATA_KEYS = new Set([
  'id',
  'shipment_id',
  'port_name',
  'port_sequence',
  'is_discharge_port',
  'created_at',
  'updated_at',
  'contract_number',
  'contract_id',
  'deleted_at',
  'is_active',
]);

/**
 * A name that identifies no particular port: blank, the generic "Loading Port N" /
 * "Discharge Port" labels, or a bare number (26 rows in production have a numeric port_name,
 * e.g. "73.15" — a separate data bug, but here it just means "unnamed").
 */
export function isPlaceholderPortName(name: unknown): boolean {
  const n = String(name ?? '').trim();
  if (!n) return true;
  if (/^[0-9]+([.,][0-9]+)?$/.test(n)) return true;
  if (/^loading\s*port\s*[0-9]*$/i.test(n)) return true;
  if (/^discharge\s*port\s*[0-9]*$/i.test(n)) return true;
  if (/^port\s*[0-9]*$/i.test(n)) return true;
  return false;
}

/** How much real data a row carries — used to pick the survivor. */
export function portRowDataScore(row: Record<string, unknown>): number {
  let score = 0;
  for (const [key, value] of Object.entries(row)) {
    if (NON_DATA_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    score += 1;
  }
  return score;
}

function slotKey(row: Record<string, unknown>): string {
  const seq = row.port_sequence == null ? 'null' : String(row.port_sequence);
  const disch = row.is_discharge_port ? '1' : '0';
  return `${seq}|${disch}`;
}

/** Sentinel identity for rows that name no particular port. Cannot collide with a
 *  normalized port name, which is uppercase alphanumerics and single spaces only. */
const UNNAMED = '#unnamed';

/**
 * Normalise a port name for identity comparison.
 *
 * The same berth is written several ways across SAP and KLIP rows - "Bulungan" vs "PORT BULUNGAN",
 * differing case, punctuation noise. Without this, one physical port survives twice and the
 * duplicate "Loading Port 1" comes back. Only the leading descriptor is dropped, so genuinely
 * different calls ("Sebulu" vs "Muara Kaman") stay distinct.
 */
export function normalizePortIdentity(name: unknown): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityKey(row: Record<string, unknown>): string {
  // Placeholder-named rows share one identity so they merge into a real-named row when present.
  return isPlaceholderPortName(row.port_name) ? UNNAMED : normalizePortIdentity(row.port_name);
}

function timeValue(row: Record<string, unknown>): number {
  const raw = row.updated_at ?? row.created_at;
  if (!raw) return 0;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Pick the survivor: most populated wins; then the anchor shipment's own row (so the user sees
 * their own record when both are equally empty); then most recently updated.
 */
function isBetter(
  candidate: Record<string, unknown>,
  incumbent: Record<string, unknown>,
  anchorShipmentId?: string | null,
): boolean {
  const cScore = portRowDataScore(candidate);
  const iScore = portRowDataScore(incumbent);
  if (cScore !== iScore) return cScore > iScore;

  if (anchorShipmentId) {
    const cAnchor = String(candidate.shipment_id ?? '') === anchorShipmentId;
    const iAnchor = String(incumbent.shipment_id ?? '') === anchorShipmentId;
    if (cAnchor !== iAnchor) return cAnchor;
  }

  return timeValue(candidate) > timeValue(incumbent);
}

/**
 * Collapse same-slot duplicates across STO group members, preserving input order of the survivors.
 */
export function dedupeStoGroupPorts<T extends Record<string, unknown>>(
  rows: T[],
  anchorShipmentId?: string | null,
): T[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows ?? [];

  // slot -> identity -> winning row
  const winners = new Map<string, Map<string, T>>();
  for (const row of rows) {
    const slot = slotKey(row);
    const identity = identityKey(row);
    let bySlot = winners.get(slot);
    if (!bySlot) {
      bySlot = new Map<string, T>();
      winners.set(slot, bySlot);
    }
    const incumbent = bySlot.get(identity);
    if (!incumbent || isBetter(row, incumbent, anchorShipmentId)) {
      bySlot.set(identity, row);
    }
  }

  // A real-named port in a slot makes the slot's unnamed row redundant.
  const kept = new Set<T>();
  for (const bySlot of winners.values()) {
    const hasRealName = [...bySlot.keys()].some((k) => k !== UNNAMED);
    for (const [identity, row] of bySlot) {
      if (hasRealName && identity === UNNAMED) continue;
      kept.add(row);
    }
  }

  return rows.filter((row) => kept.has(row));
}
