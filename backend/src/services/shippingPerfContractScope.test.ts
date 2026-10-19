import { describe, expect, it } from 'vitest';
import {
  applyContractGrainOutstanding,
  attachContractScope,
  type ContractScopeAttrs,
} from './shippingPerfContractGrainOs.service';

const attrs = (over: Partial<ContractScopeAttrs> = {}): ContractScopeAttrs => ({
  product: 'CPO',
  incoterm: 'CIF',
  source_type: '3rd Party',
  supplier: 'S1',
  group_name: 'G1',
  plant_site: 'BONTANG',
  contract_date: '2026-08-01',
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  contract_number: 'A, B, C',
  status: 'SAILED',
  product: 'CPO',
  outstanding_qty_aggregate: 0,
  ...over,
});

describe('contract_scope: which contracts of a STO row differ, so the page can filter them one by one', () => {
  const known = new Map<string, ContractScopeAttrs>([
    ['A', attrs()],
    ['B', attrs()],
    ['C', attrs({ product: 'POME' })],
  ]);

  it('groups the contracts of a row by identical attributes and gives each group what the row was awarded for it', () => {
    const r = row();
    applyContractGrainOutstanding([r], new Map([['A', 1000], ['B', 2000], ['C', 5000]]), known);
    const scope = (r as Record<string, unknown>).contract_scope as Array<Record<string, unknown>>;
    expect(scope.map((g) => [g.contract_number, g.product, g.outstanding_qty_aggregate])).toEqual([
      ['A, B', 'CPO', 3000],
      ['C', 'POME', 5000],
    ]);
    // the groups add up to the row's own aggregate, so nothing is created or lost by the split
    expect(scope.reduce((a, g) => a + Number(g.outstanding_qty_aggregate), 0)).toBe(r.outstanding_qty_aggregate);
  });

  it('a row that is not the furthest stage of a contract gets 0 for it, but still lists the group', () => {
    const early = row({ status: 'PLANNED' });
    const late = row({ status: 'ARRIVED_DP' });
    applyContractGrainOutstanding([early, late], new Map([['A', 1000], ['B', 2000], ['C', 5000]]), known);
    const earlyScope = (early as Record<string, unknown>).contract_scope as Array<Record<string, unknown>>;
    expect(earlyScope.map((g) => g.outstanding_qty_aggregate)).toEqual([0, 0]);
    expect(early.outstanding_qty_aggregate).toBe(0);
    expect(late.outstanding_qty_aggregate).toBe(8000);
  });

  it('adds nothing when the contracts of the row are alike and the row says the same', () => {
    const r = row({ ...attrs() });
    applyContractGrainOutstanding([r], new Map([['A', 1000]]), new Map([['A', attrs()], ['B', attrs()], ['C', attrs()]]));
    expect((r as Record<string, unknown>).contract_scope).toBeUndefined();
  });

  it('adds nothing when no attributes were loaded', () => {
    const many = row();
    applyContractGrainOutstanding([many], new Map([['A', 1000]]));
    expect((many as Record<string, unknown>).contract_scope).toBeUndefined();
  });

  it('adds nothing to a one-contract row whose values are the contract\'s own', () => {
    const one = row({ contract_number: 'A', ...attrs() });
    applyContractGrainOutstanding([one], new Map([['A', 1000]]), known);
    expect((one as Record<string, unknown>).contract_scope).toBeUndefined();
  });

  it('gives a ONE-contract row a scope when the row carries another contract\'s supplier (relabelled B2B child)', () => {
    const one = row({ contract_number: 'A', ...attrs({ supplier: 'CHILD SUPPLIER' }) });
    applyContractGrainOutstanding([one], new Map([['A', 4500]]), new Map([['A', attrs({ supplier: 'ORIGIN SUPPLIER' })]]));
    const scope = (one as Record<string, unknown>).contract_scope as Array<Record<string, unknown>>;
    expect(scope).toHaveLength(1);
    expect([scope[0]!.supplier, scope[0]!.outstanding_qty_aggregate]).toEqual(['ORIGIN SUPPLIER', 4500]);
  });

  it('a list-valued row field that contains the contract\'s value describes it', () => {
    const one = row({ contract_number: 'A', ...attrs({ supplier: 'S0, S1' }) });
    applyContractGrainOutstanding([one], new Map([['A', 1]]), new Map([['A', attrs({ supplier: 'S1' })]]));
    expect((one as Record<string, unknown>).contract_scope).toBeUndefined();
  });

  it('a contract the lookup did not find takes the row\'s own values and joins its group', () => {
    const r = row({ ...attrs() });
    attachContractScope(r, new Map([['A', 100], ['B', 200], ['C', 300]]), new Map([['A', attrs()], ['C', attrs({ product: 'POME' })]]));
    const scope = (r as Record<string, unknown>).contract_scope as Array<Record<string, unknown>>;
    expect(scope.map((g) => g.contract_number)).toEqual(['A, B', 'C']);
  });

  it('differences in letter case or spacing are not differences', () => {
    const r = row({ contract_number: 'A, B', ...attrs() });
    attachContractScope(r, undefined, new Map([['A', attrs({ supplier: 'S1' })], ['B', attrs({ supplier: ' s1 ' })]]));
    expect((r as Record<string, unknown>).contract_scope).toBeUndefined();
  });

  it('a stale scope from an earlier run is cleared, not kept', () => {
    const r = row({ contract_number: 'A, B', ...attrs() }) as Record<string, unknown>;
    r.contract_scope = [{ stale: true }];
    attachContractScope(r as ReturnType<typeof row>, undefined, new Map([['A', attrs()], ['B', attrs()]]));
    expect(r.contract_scope).toBeUndefined();
  });

  it('a contract finished by its own ATC in an operation group is not awarded to that row', () => {
    const r = row({ contract_number: 'A, B', status: 'COMPLETED', os_status: 'UNLOADING', os_finished_contracts: ['A'], ...attrs() });
    applyContractGrainOutstanding([r], new Map([['A', 1000], ['B', 2000]]), new Map([['A', attrs()], ['B', attrs()]]));
    expect(r.outstanding_qty_aggregate).toBe(2000);
  });

  it('backlog rows are left exactly as they are', () => {
    const backlog = row({ is_unplanned_backlog: true, outstanding_qty_aggregate: 777 });
    applyContractGrainOutstanding([backlog], new Map([['A', 1000]]), known);
    expect(backlog.outstanding_qty_aggregate).toBe(777);
    expect((backlog as Record<string, unknown>).contract_scope).toBeUndefined();
  });
});
