/**
 * A PO the export lists on several lines, some deleted and some not.
 *
 * Delete PO Status is a flag on a LINE of the export. SAP can delete one item of a PO and leave another open, and then
 * the same Contract No + PO No appears twice - one line with Delete PO Status "S", one without. KLIP used to treat the
 * deleted line as the whole PO: it overwrote the open line's stored row (rows sharing PO + STO are one stored row, the
 * last one written wins), switched the contract to Cancelled and cancelled every linked shipment and trucking operation.
 *
 * The rule: a PO is Cancelled only when EVERY line of it is deleted. While at least one line is not, the deleted lines are
 * set aside - not stored, not summed into quantities, and above all not allowed to cancel anything - and the open line
 * decides. Delete STO Status is a separate, per-STO flag and is not touched here.
 *
 * Scope is one file: it decides between the lines the file holds. A deleted row stored by an EARLIER import under a
 * different STO is not touched by a later file, so it keeps its flag until it is re-imported.
 */
import { hasSapDeletePoFlag } from './sapMasterV2UatFormat';

export interface DeletedPoLineCandidate {
  contractNumber: string | null;
  poNumber: string | null;
  parsedData: {
    contract?: Record<string, unknown> | null;
    shipment?: Record<string, unknown> | null;
    raw?: Record<string, unknown> | null;
  };
  /** Set by markSupersededDeletedPoLines. */
  supersededDeletedPoLine?: boolean;
}

function poGroupKey(c: DeletedPoLineCandidate): string | null {
  const po = String(c.poNumber ?? '').trim();
  if (!po) return null;
  return `${String(c.contractNumber ?? '').trim()}\u0000${po}`;
}

/**
 * Flag the deleted lines of every PO that also has a line that is not deleted. Returns how many lines were set aside.
 * A PO whose lines are all deleted, or that has a single line, is left exactly as it was.
 */
export function markSupersededDeletedPoLines<T extends DeletedPoLineCandidate>(candidates: T[]): number {
  const groups = new Map<string, T[]>();
  for (const c of candidates) {
    const key = poGroupKey(c);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  let superseded = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const live = group.filter((c) => !hasSapDeletePoFlag(c.parsedData));
    if (live.length === 0) continue; // every line deleted: the PO really is cancelled
    for (const c of group) {
      if (hasSapDeletePoFlag(c.parsedData)) {
        c.supersededDeletedPoLine = true;
        superseded += 1;
      }
    }
  }
  return superseded;
}
