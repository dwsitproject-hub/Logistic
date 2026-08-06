import { getPrePlannedConfig } from '../config/prePlannedConfig';

export interface PrePlannedEligibleContract {
  id: string;
  contractId: string;
  groupPlant: string;
  buyer: string;
  incoterm: string;
  product: string;
  supplier: string;
  supplierGroup: string | null;
  contractDate: Date;
  deliveryStart: Date;
  deliveryEnd: Date;
  osMt: number;
  contractQtyMt: number;
}

export interface PackedCapacityBin {
  members: PrePlannedEligibleContract[];
  binCapacityMt: number;
}

export interface PrePlannedClusterBin {
  partitionKey: string;
  groupPlant: string;
  buyer: string;
  incoterm: string;
  product: string;
  supplier: string;
  supplierGroup: string | null;
  windowStart: Date;
  windowEnd: Date;
  binCapacityMt: number;
  totalOsMt: number;
  isPartial: boolean;
  members: PrePlannedEligibleContract[];
}

function partitionKey(c: PrePlannedEligibleContract): string {
  return [c.groupPlant, c.buyer, c.incoterm, c.product].join('|');
}

function dayDiff(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / 86_400_000;
}

function compareContracts(a: PrePlannedEligibleContract, b: PrePlannedEligibleContract): number {
  const dc = a.contractDate.getTime() - b.contractDate.getTime();
  if (dc !== 0) return dc;
  return a.contractId.localeCompare(b.contractId);
}

/**
 * One cluster per supplier within a partition — vessel capacity packing (step 4) splits
 * overflow bins; planners reconcile qty vs vessel capacity at accept time.
 */
export function clusterBySupplier(
  contracts: PrePlannedEligibleContract[],
): PrePlannedEligibleContract[][] {
  if (contracts.length === 0) return [];
  return [[...contracts].sort(compareContracts)];
}

/** @deprecated Prefer clusterBySupplier; kept for legacy tests / optional date chaining. */
export function chainWindowClusters(
  contracts: PrePlannedEligibleContract[],
  windowTolDays: number,
): PrePlannedEligibleContract[][] {
  const sorted = [...contracts].sort(compareContracts);
  const clusters: PrePlannedEligibleContract[][] = [];

  for (const c of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      const anchor = cluster[0]!;
      if (dayDiff(c.contractDate, anchor.contractDate) <= windowTolDays) {
        cluster.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([c]);
    }
  }
  return clusters;
}

function binCapacityForMembers(
  members: PrePlannedEligibleContract[],
  parcelMt: number,
): number {
  const largestOs = members.reduce((m, c) => Math.max(m, c.osMt), 0);
  const largestQty = members.reduce((m, c) => Math.max(m, c.contractQtyMt), 0);
  return Math.max(parcelMt, largestOs, largestQty);
}

/** Capacity bin packing (spec §4.3 step 4). */
export function packCapacityBins(
  contracts: PrePlannedEligibleContract[],
  parcelMt: number,
  capTol: number,
): { bins: PackedCapacityBin[]; isPartial: boolean } {
  const sorted = [...contracts].sort((a, b) => a.contractId.localeCompare(b.contractId));
  const bins: PackedCapacityBin[] = [];
  let current: PrePlannedEligibleContract[] = [];
  let used = 0;

  const flushCurrent = () => {
    if (current.length === 0) return;
    bins.push({
      members: current,
      binCapacityMt: binCapacityForMembers(current, parcelMt),
    });
    current = [];
    used = 0;
  };

  for (const c of sorted) {
    if (c.contractQtyMt > parcelMt) {
      flushCurrent();
      bins.push({
        members: [c],
        binCapacityMt: binCapacityForMembers([c], parcelMt),
      });
      continue;
    }

    if (current.length === 0 || used + c.osMt <= parcelMt * capTol) {
      current.push(c);
      used += c.osMt;
    } else {
      flushCurrent();
      current = [c];
      used = c.osMt;
    }
  }
  flushCurrent();

  const isPartial =
    bins.length > 1 ||
    sorted.some((c) => c.contractQtyMt > parcelMt || c.osMt > parcelMt);

  return { bins, isPartial };
}

export function buildClusterBins(
  contracts: PrePlannedEligibleContract[],
  parcelMtByPlant: Map<string, number>,
): PrePlannedClusterBin[] {
  const cfg = getPrePlannedConfig();
  const bins: PrePlannedClusterBin[] = [];

  const byPartition = new Map<string, PrePlannedEligibleContract[]>();
  for (const c of contracts) {
    const key = partitionKey(c);
    const list = byPartition.get(key) ?? [];
    list.push(c);
    byPartition.set(key, list);
  }

  for (const [, partitionContracts] of byPartition) {
    const bySupplier = new Map<string, PrePlannedEligibleContract[]>();
    for (const c of partitionContracts) {
      const sk = c.supplier.trim().toUpperCase();
      const list = bySupplier.get(sk) ?? [];
      list.push(c);
      bySupplier.set(sk, list);
    }

    for (const [, supplierContracts] of bySupplier) {
      const windowClusters = clusterBySupplier(supplierContracts);
      for (const cluster of windowClusters) {
        const plant = cluster[0]!.groupPlant;
        const parcelMt =
          parcelMtByPlant.get(plant) ??
          parcelMtByPlant.get('__fallback__') ??
          cfg.parcelFallbackMt;
        const packed = packCapacityBins(cluster, parcelMt, cfg.capTol);
        for (const packedBin of packed.bins) {
          const binMembers = packedBin.members;
          const contractDates = binMembers.map((m) => m.contractDate.getTime());
          const windowStart = new Date(Math.min(...contractDates));
          const windowEnd = new Date(Math.max(...contractDates));
          const anchor = binMembers[0]!;
          const totalOsMt = binMembers.reduce((s, m) => s + m.osMt, 0);
          bins.push({
            partitionKey: partitionKey(anchor),
            groupPlant: anchor.groupPlant,
            buyer: anchor.buyer,
            incoterm: anchor.incoterm,
            product: anchor.product,
            supplier: anchor.supplier,
            supplierGroup: anchor.supplierGroup,
            windowStart,
            windowEnd,
            binCapacityMt: packedBin.binCapacityMt,
            totalOsMt,
            isPartial: packed.isPartial,
            members: binMembers,
          });
        }
      }
    }
  }

  return bins;
}

/** Tier 2 merge hints — pairs of groups in same partition with same supplier_group (spec §4.5). */
export function computeMergeHints(
  bins: PrePlannedClusterBin[],
  tier2GapDays: number,
): Map<number, number[]> {
  const hints = new Map<number, number[]>();
  for (let i = 0; i < bins.length; i++) {
    for (let j = i + 1; j < bins.length; j++) {
      const a = bins[i]!;
      const b = bins[j]!;
      if (a.partitionKey !== b.partitionKey) continue;
      const sgA = (a.supplierGroup ?? '').trim();
      const sgB = (b.supplierGroup ?? '').trim();
      if (!sgA || sgA !== sgB) continue;
      const gapStart = dayDiff(a.windowStart, b.windowStart);
      const gapEnd = dayDiff(a.windowEnd, b.windowEnd);
      if (gapStart <= tier2GapDays && gapEnd <= tier2GapDays) {
        const listA = hints.get(i) ?? [];
        listA.push(j);
        hints.set(i, listA);
        const listB = hints.get(j) ?? [];
        listB.push(i);
        hints.set(j, listB);
      }
    }
  }
  return hints;
}

export function plantCodePrefix(groupPlant: string): string {
  const cleaned = groupPlant.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.slice(0, 6) || 'PLANT';
}
