import { describe, it, expect } from 'vitest';
import {
  chainWindowClusters,
  packCapacityBins,
  buildClusterBins,
  computeMergeHints,
  type PrePlannedEligibleContract,
} from './prePlannedClustering.service';

function contract(partial: Partial<PrePlannedEligibleContract> & Pick<PrePlannedEligibleContract, 'contractId'>): PrePlannedEligibleContract {
  return {
    id: partial.contractId,
    contractId: partial.contractId,
    groupPlant: partial.groupPlant ?? 'Bontang',
    buyer: partial.buyer ?? 'KPN',
    incoterm: partial.incoterm ?? 'FOB',
    product: partial.product ?? 'CPO',
    supplier: partial.supplier ?? 'Supplier A',
    supplierGroup: partial.supplierGroup ?? null,
    deliveryStart: partial.deliveryStart ?? new Date('2026-08-01'),
    deliveryEnd: partial.deliveryEnd ?? new Date('2026-08-10'),
    osMt: partial.osMt ?? 500,
  };
}

describe('prePlannedClustering.service', () => {
  it('chains contracts within window tolerance', () => {
    const c1 = contract({ contractId: 'C1', deliveryStart: new Date('2026-08-01'), deliveryEnd: new Date('2026-08-10') });
    const c2 = contract({ contractId: 'C2', deliveryStart: new Date('2026-08-03'), deliveryEnd: new Date('2026-08-12') });
    const clusters = chainWindowClusters([c2, c1], 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('splits contracts outside window tolerance', () => {
    const c1 = contract({ contractId: 'C1', deliveryStart: new Date('2026-08-01'), deliveryEnd: new Date('2026-08-10') });
    const c2 = contract({ contractId: 'C2', deliveryStart: new Date('2026-08-20'), deliveryEnd: new Date('2026-08-25') });
    const clusters = chainWindowClusters([c1, c2], 3);
    expect(clusters).toHaveLength(2);
  });

  it('packs capacity bins with overflow', () => {
    const members = [
      contract({ contractId: 'C1', osMt: 2000 }),
      contract({ contractId: 'C2', osMt: 2000 }),
    ];
    const { bins } = packCapacityBins(members, 2700, 1.05);
    expect(bins.length).toBeGreaterThanOrEqual(2);
  });

  it('buildClusterBins respects partition and supplier', () => {
    const map = new Map([['Bontang', 2700], ['__fallback__', 3000]]);
    const bins = buildClusterBins(
      [
        contract({ contractId: 'C1', supplier: 'Sup A' }),
        contract({ contractId: 'C2', supplier: 'Sup B' }),
      ],
      map,
    );
    expect(bins).toHaveLength(2);
  });

  it('computeMergeHints links same supplier group within gap', () => {
    const bins = buildClusterBins(
      [
        contract({ contractId: 'C1', supplier: 'Sup A', supplierGroup: 'Grp1', deliveryStart: new Date('2026-08-01'), deliveryEnd: new Date('2026-08-05') }),
        contract({ contractId: 'C2', supplier: 'Sup B', supplierGroup: 'Grp1', deliveryStart: new Date('2026-08-06'), deliveryEnd: new Date('2026-08-10') }),
      ],
      new Map([['Bontang', 5000], ['__fallback__', 5000]]),
    );
    const hints = computeMergeHints(bins, 7);
    expect(hints.size).toBeGreaterThan(0);
  });
});
