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
 * decides. Delete STO Status is a separate, per-STO flag: markStoDeletedWithLiveSibling (below) keeps it from cancelling a PO that still has a live STO.
 *
 * The lines of a PO are found by PO No, not by Contract No + PO No. The export carries STO-level lines whose Contract No is BLANK
 * (see sapDataDistribution upsertContract: those lines match the contract by PO), so the open line of a PO can have no contract
 * number while its deleted line names one. Keyed by contract + PO the two never met: PO 1001031718 (open line with a blank Contract No,
 * deleted line 1004031718) had its deleted line cancel the contract's shipment on 2026-10-13 although the PO was open. Only when the
 * file gives one PO two DIFFERENT contract numbers is the contract kept in the key, as before.
 *
 * Scope is one file: it decides between the lines the file holds. A deleted row stored by an EARLIER import under a
 * different STO is not touched by a later file, so it keeps its flag until it is re-imported.
 */
import { hasSapDeleteFlag, hasSapDeletePoFlag } from './sapMasterV2UatFormat';

export interface DeletedPoLineCandidate {
  contractNumber: string | null;
  poNumber: string | null;
  parsedData: {
    contract?: Record<string, unknown> | null;
    shipment?: Record<string, unknown> | null;
    raw?: Record<string, unknown> | null;
  };
  /** The STO this line is for, when the caller has it; a Delete STO line is set aside when a live line of the SAME STO exists. */
  stoKey?: string;
  /** Set by markSupersededDeletedPoLines. */
  supersededDeletedPoLine?: boolean;
}

function poGroupKey(c: DeletedPoLineCandidate, poHasSeveralContracts: ReadonlySet<string>): string | null {
  const po = String(c.poNumber ?? '').trim();
  if (!po) return null;
  // One PO, one contract (blank counts as "not named"): the PO is the group.
  if (!poHasSeveralContracts.has(po)) return po;
  return `${String(c.contractNumber ?? '').trim()}\u0000${po}`;
}

/** POs this file names with two or more different, non-blank contract numbers. */
function posWithSeveralContracts(candidates: DeletedPoLineCandidate[]): Set<string> {
  const contractsByPo = new Map<string, Set<string>>();
  for (const c of candidates) {
    const po = String(c.poNumber ?? '').trim();
    const contract = String(c.contractNumber ?? '').trim();
    if (!po || !contract) continue;
    const set = contractsByPo.get(po);
    if (set) set.add(contract);
    else contractsByPo.set(po, new Set([contract]));
  }
  return new Set([...contractsByPo.entries()].filter(([, set]) => set.size > 1).map(([po]) => po));
}

/**
 * Flag the deleted lines of every PO that also has a line that is not deleted. Returns how many lines were set aside.
 * A PO whose lines are all deleted, or that has a single line, is left exactly as it was.
 */
export function markSupersededDeletedPoLines<T extends DeletedPoLineCandidate>(candidates: T[]): number {
  const groups = new Map<string, T[]>();
  const severalContracts = posWithSeveralContracts(candidates);
  for (const c of candidates) {
    const key = poGroupKey(c, severalContracts);
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

/**
 * Delete STO Status is the flag of ONE STO of the PO, and it must not cancel the PO.
 *
 * KLIP used to read a Delete STO Status line like a Delete PO Status one: the contract went to CANCELLED and every shipment and trucking operation of it
 * was cancelled. PO 1001032300 (contract 1004032300) has two STO lines in the export, STO 1006020464 open and STO 1006020263 with Delete STO Status "L",
 * GR PO and GR STO both Open - and KLIP held the whole contract CANCELLED, while the read side (contractDeliveryStatus) already cancelled per STO and the
 * PO only when EVERY STO is deleted. This is the write-side half of that rule.
 *
 * A line that carries Delete STO Status (and no Delete PO Status) while the same PO has a line that carries neither, in the same file:
 *  - the same STO as that live line: set aside like a superseded PO line (rows sharing PO + STO are one stored row; the deleted one must not overwrite it);
 *  - another STO: stored and distributed as before - its own STO's shipment is still cancelled - but flagged here so it does NOT cancel the contract or the
 *    PO's other shipments (sapDeleteForcesContractCancel).
 * A PO whose every line is deleted, or that has a single line, behaves exactly as before. Scope is one file, like markSupersededDeletedPoLines.
 */
const STO_DELETED_WITH_LIVE_SIBLING = new WeakSet<object>();

/** Returns how many lines were flagged (flagged ones) and set aside (same-STO ones). Run it AFTER markSupersededDeletedPoLines. */
export function markStoDeletedWithLiveSibling<T extends DeletedPoLineCandidate>(
  candidates: T[],
): { flagged: number; setAside: number } {
  const groups = new Map<string, T[]>();
  const severalContracts = posWithSeveralContracts(candidates);
  for (const c of candidates) {
    if (c.supersededDeletedPoLine) continue;
    const key = poGroupKey(c, severalContracts);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  let flagged = 0;
  let setAside = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const live = group.filter((c) => !hasSapDeleteFlag(c.parsedData));
    if (live.length === 0) continue; // every line carries a delete flag: the PO really is cancelled
    const liveStos = new Set(live.map((c) => String(c.stoKey ?? '').trim()).filter(Boolean));
    for (const c of group) {
      if (!hasSapDeleteFlag(c.parsedData) || hasSapDeletePoFlag(c.parsedData)) continue;
      const sto = String(c.stoKey ?? '').trim();
      if (sto && liveStos.has(sto)) {
        c.supersededDeletedPoLine = true;
        setAside += 1;
      } else {
        STO_DELETED_WITH_LIVE_SIBLING.add(c.parsedData);
        flagged += 1;
      }
    }
  }
  return { flagged, setAside };
}

/** True when this line was flagged by markStoDeletedWithLiveSibling: a deleted STO of a PO that is still alive. */
export function isStoDeletedWithLiveSibling(parsedData: object | null | undefined): boolean {
  return !!parsedData && STO_DELETED_WITH_LIVE_SIBLING.has(parsedData);
}

/**
 * Whether this line may cancel the CONTRACT (status Cancelled, every shipment and trucking operation of it): a Delete PO Status line always, a Delete STO
 * Status line unless its PO is still alive. The STO's own shipment is cancelled either way (the shipment upsert reads hasSapDeleteFlag).
 */
export function sapDeleteForcesContractCancel(parsedData: {
  contract?: Record<string, unknown> | null;
  shipment?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
}): boolean {
  if (!hasSapDeleteFlag(parsedData)) return false;
  if (hasSapDeletePoFlag(parsedData)) return true;
  return !isStoDeletedWithLiveSibling(parsedData);
}
