import { describe, it, expect } from 'vitest';
import {
  chainWindowClusters,
  clusterBySupplier,
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
    contractDate: partial.contractDate ?? new Date('2026-08-01'),
    deliveryStart: partial.deliveryStart ?? new Date('2026-08-01'),
    deliveryEnd: partial.deliveryEnd ?? new Date('2026-08-10'),
    osMt: partial.osMt ?? 500,
    contractQtyMt: partial.contractQtyMt ?? partial.osMt ?? 500,
  };
}

describe('prePlannedClustering.service', () => {
  it('chains contracts within contract-date tolerance', () => {
    const c1 = contract({ contractId: 'C1', contractDate: new Date('2026-08-01') });
    const c2 = contract({ contractId: 'C2', contractDate: new Date('2026-08-03') });
    const clusters = chainWindowClusters([c2, c1], 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('splits contracts outside contract-date tolerance', () => {
    const c1 = contract({ contractId: 'C1', contractDate: new Date('2026-08-01') });
    const c2 = contract({ contractId: 'C2', contractDate: new Date('2026-08-10') });
    const clusters = chainWindowClusters([c1, c2], 3);
    expect(clusters).toHaveLength(2);
  });

  it('does not chain by delivery window when contract dates differ beyond tolerance', () => {
    const c1 = contract({
      contractId: 'C1',
      contractDate: new Date('2026-08-01'),
      deliveryStart: new Date('2026-08-01'),
      deliveryEnd: new Date('2026-08-05'),
    });
    const c2 = contract({
      contractId: 'C2',
      contractDate: new Date('2026-08-10'),
      deliveryStart: new Date('2026-08-02'),
      deliveryEnd: new Date('2026-08-04'),
    });
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

  it('clusterBySupplier keeps all contracts in one cluster regardless of contract date spread', () => {
    const weekly = [
      contract({ contractId: 'C1', contractDate: new Date('2026-07-03') }),
      contract({ contractId: 'C2', contractDate: new Date('2026-07-10') }),
      contract({ contractId: 'C3', contractDate: new Date('2026-07-17') }),
    ];
    expect(clusterBySupplier(weekly)).toHaveLength(1);
    expect(clusterBySupplier(weekly)[0]).toHaveLength(3);
  });

  it('buildClusterBins merges same-supplier weekly contracts when total OS fits parcel capacity', () => {
    const map = new Map([['Bontang', 3000], ['__fallback__', 3000]]);
    const supplier = 'WAHANA KARYA SEJAHTERA MANDIRI PT.';
    const bins = buildClusterBins(
      [
        contract({ contractId: '1001030968', contractDate: new Date('2026-07-03'), osMt: 300, supplier }),
        contract({ contractId: '1001031128', contractDate: new Date('2026-07-10'), osMt: 900, supplier }),
        contract({ contractId: '1001031286', contractDate: new Date('2026-07-17'), osMt: 500, supplier }),
        contract({ contractId: '1001031426', contractDate: new Date('2026-07-24'), osMt: 500, supplier }),
        contract({ contractId: '1001031610', contractDate: new Date('2026-07-31'), osMt: 800, supplier }),
      ],
      map,
    );
    expect(bins).toHaveLength(1);
    expect(bins[0]!.members).toHaveLength(5);
    expect(bins[0]!.totalOsMt).toBe(3000);
  });

  it('buildClusterBins splits same-supplier contracts when total OS exceeds parcel capacity', () => {
    const map = new Map([['Bontang', 3000], ['__fallback__', 3000]]);
    const supplier = 'WAHANA KARYA SEJAHTERA MANDIRI PT.';
    const bins = buildClusterBins(
      [
        contract({ contractId: 'C1', contractDate: new Date('2026-07-03'), osMt: 2000, supplier }),
        contract({ contractId: 'C2', contractDate: new Date('2026-07-10'), osMt: 2000, supplier }),
      ],
      map,
    );
    expect(bins.length).toBeGreaterThanOrEqual(2);
  });

  it('isolates contracts whose contract qty exceeds parcel capacity even when OS is lower', () => {
    const map = new Map([['Bontang', 3000], ['__fallback__', 3000]]);
    const supplier = 'WAHANA KARYA SEJAHTERA MANDIRI PT.';
    const bins = buildClusterBins(
      [
        contract({
          contractId: 'BIG',
          osMt: 2000,
          contractQtyMt: 5000,
          supplier,
        }),
        contract({
          contractId: 'SMALL',
          osMt: 500,
          contractQtyMt: 500,
          supplier,
        }),
      ],
      map,
    );
    expect(bins).toHaveLength(2);
    expect(bins.find((b) => b.members.some((m) => m.contractId === 'BIG'))?.members).toHaveLength(1);
    expect(bins.find((b) => b.members.some((m) => m.contractId === 'SMALL'))?.members).toHaveLength(1);
    expect(bins.some((b) => b.isPartial)).toBe(true);
  });

  it('computeMergeHints links same supplier group within gap', () => {
    const bins = buildClusterBins(
      [
        contract({ contractId: 'C1', supplier: 'Sup A', supplierGroup: 'Grp1', contractDate: new Date('2026-08-01') }),
        contract({ contractId: 'C2', supplier: 'Sup B', supplierGroup: 'Grp1', contractDate: new Date('2026-08-06') }),
      ],
      new Map([['Bontang', 5000], ['__fallback__', 5000]]),
    );
    const hints = computeMergeHints(bins, 7);
    expect(hints.size).toBeGreaterThan(0);
  });
});
