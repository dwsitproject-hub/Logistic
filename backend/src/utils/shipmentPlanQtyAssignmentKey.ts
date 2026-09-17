/**
 * Keys for shipment plan qty payloads from Add New Shipment:
 * - contract row UUID (contracts.id)
 * - "contractNumber::poNumber"
 * - bare contract number
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedShipmentPlanQtyKey =
  | { kind: 'uuid'; id: string }
  | { kind: 'contract_po'; contractNumber: string; poNumber: string | null }
  | { kind: 'contract'; contractNumber: string };

export function parseShipmentPlanQtyAssignmentKey(rawKey: string): ParsedShipmentPlanQtyKey | null {
  const key = String(rawKey ?? '').trim();
  if (!key) return null;
  if (UUID_RE.test(key)) {
    return { kind: 'uuid', id: key };
  }
  if (key.includes('::')) {
    const [cn, po] = key.split('::');
    const contractNumber = String(cn ?? '').trim();
    if (!contractNumber) return null;
    const poNumber = String(po ?? '').trim() || null;
    return { kind: 'contract_po', contractNumber, poNumber };
  }
  return { kind: 'contract', contractNumber: key };
}

export interface ShipmentPlanQtyAssignmentTarget {
  contractNumber: string;
  poNumber: string | null;
  qtyMt: number;
}

/**
 * Normalize UI assignment maps (MT) into contract_number + po_number targets.
 * UUID keys must be resolved via `resolveUuid` (contracts.id → contract_id / po_number).
 */
export async function resolveShipmentPlanQtyAssignmentTargets(
  entries: Record<string, unknown>,
  resolveUuid: (
    ids: string[],
  ) => Promise<Map<string, { contractNumber: string; poNumber: string | null }>>,
): Promise<ShipmentPlanQtyAssignmentTarget[]> {
  const out: ShipmentPlanQtyAssignmentTarget[] = [];
  const uuidPending: Array<{ id: string; qtyMt: number }> = [];

  for (const [rawKey, qty] of Object.entries(entries)) {
    const n = parseFloat(String(qty));
    if (Number.isNaN(n) || n <= 0) continue;
    const parsed = parseShipmentPlanQtyAssignmentKey(rawKey);
    if (!parsed) continue;
    if (parsed.kind === 'uuid') {
      uuidPending.push({ id: parsed.id, qtyMt: n });
      continue;
    }
    if (parsed.kind === 'contract_po') {
      out.push({
        contractNumber: parsed.contractNumber,
        poNumber: parsed.poNumber,
        qtyMt: n,
      });
      continue;
    }
    out.push({
      contractNumber: parsed.contractNumber,
      poNumber: null,
      qtyMt: n,
    });
  }

  if (uuidPending.length > 0) {
    const ids = [...new Set(uuidPending.map((p) => p.id))];
    const byId = await resolveUuid(ids);
    for (const pending of uuidPending) {
      const row = byId.get(pending.id);
      if (!row?.contractNumber) continue;
      out.push({
        contractNumber: row.contractNumber,
        poNumber: row.poNumber,
        qtyMt: pending.qtyMt,
      });
    }
  }

  return out;
}
