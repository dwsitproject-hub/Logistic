import { describe, expect, it } from 'vitest';
import { applyB2bParentPreference } from './shippingPerfContractGrainOs.service';

/**
 * B2B double counting is how outstanding ballooned on this page before, which is why only one side
 * of a family is ever valued. The STO merge now unions the contract numbers from sto_metrics with
 * the ones the rows carry, so a child and its origin CAN in principle arrive together - measured 0
 * of 566 pairs on dev, but nothing in the query forbids it.
 */
describe('B2B: the parent is preferred, the child is the fallback', () => {
  it('drops the child when the parent carries outstanding', () => {
    const os = new Map([['9194100034', 3_200_000], ['1004030568', 3_200_000]]);
    applyB2bParentPreference(os, [{ child: '1004030568', origin: '9194100034' }]);
    expect([...os.keys()]).toEqual(['9194100034']);
    expect(os.get('9194100034')).toBe(3_200_000);
  });

  it('keeps the child when the parent carries nothing - "jika null ambil dari child"', () => {
    const os = new Map([['1004030568', 3_200_000]]);
    applyB2bParentPreference(os, [{ child: '1004030568', origin: '9194100034' }]);
    expect(os.get('1004030568')).toBe(3_200_000);
  });

  it('keeps the child when the parent is present but valued at zero', () => {
    const os = new Map([['9194100034', 0], ['1004030568', 3_200_000]]);
    applyB2bParentPreference(os, [{ child: '1004030568', origin: '9194100034' }]);
    expect(os.get('1004030568')).toBe(3_200_000);
  });

  it('leaves contracts with no B2B link alone', () => {
    const os = new Map([['C1', 100], ['C2', 200]]);
    applyB2bParentPreference(os, []);
    expect([...os.keys()].sort()).toEqual(['C1', 'C2']);
  });
});
