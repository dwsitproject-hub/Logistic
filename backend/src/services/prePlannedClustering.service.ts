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
  deliveryStart: Date;
  deliveryEnd: Date;
  osMt: number;
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
  const ds = a.deliveryStart.getTime() - b.deliveryStart.getTime();
  if (ds !== 0) return ds;
  return a.contractId.localeCompare(b.contractId);
}

/** Chain window clusters within a supplier sub-partition (spec §4.3 step 3). */
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
      if (
        dayDiff(c.deliveryStart, anchor.deliveryStart) <= windowTolDays &&
        dayDiff(c.deliveryEnd, anchor.deliveryEnd) <= windowTolDays
      ) {
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

/** Capacity bin packing (spec §4.3 step 4). */
export function packCapacityBins(
  contracts: PrePlannedEligibleContract[],
  parcelMt: number,
  capTol: number,
): { bins: PrePlannedEligibleContract[][]; binCapacityMt: number; isPartial: boolean } {
  const sorted = [...contracts].sort((a, b) => a.contractId.localeCompare(b.contractId));
  const largest = sorted.reduce((m, c) => Math.max(m, c.osMt), 0);
  const cap = Math.max(parcelMt, largest);
  const bins: PrePlannedEligibleContract[][] = [];
  let current: PrePlannedEligibleContract[] = [];
  let used = 0;

  for (const c of sorted) {
    if (current.length === 0 || used + c.osMt <= cap * capTol) {
      current.push(c);
      used += c.osMt;
    } else {
      bins.push(current);
      current = [c];
      used = c.osMt;
    }
  }
  if (current.length > 0) {
    bins.push(current);
  }

  const isPartial = sorted.some((c) => c.osMt > cap) || bins.length > 1;
  return { bins, binCapacityMt: cap, isPartial };
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
      const windowClusters = chainWindowClusters(supplierContracts, cfg.windowTolDays);
      for (const cluster of windowClusters) {
        const plant = cluster[0]!.groupPlant;
        const parcelMt =
          parcelMtByPlant.get(plant) ??
          parcelMtByPlant.get('__fallback__') ??
          cfg.parcelFallbackMt;
        const packed = packCapacityBins(cluster, parcelMt, cfg.capTol);
        for (const binMembers of packed.bins) {
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
            windowStart: anchor.deliveryStart,
            windowEnd: anchor.deliveryEnd,
            binCapacityMt: packed.binCapacityMt,
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
