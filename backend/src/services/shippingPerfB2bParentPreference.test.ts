import { describe, expect, it } from 'vitest';
import { applyB2bParentPreference } from './shippingPerfContractGrainOs.service';

/**
 * B2B double counting is how outstanding ballooned on this page before, which is why only one side
 * of a family is ever valued. The STO merge now unions the contract numbers from sto_metrics with
 * the ones the rows carry, so a child and its origin CAN in principle arrive together - measured 0
 * of 566 pairs on dev, but nothing in the query forbids it.
 */
describe('B2B: the parent is the source, the child only a carrier', () => {
  it('drops the child when the parent has a movement record', () => {
    const os = new Map([['9194100034', 3_200_000], ['1004030568', 3_200_000]]);
    applyB2bParentPreference(os, [
      { child: '1004030568', origin: '9194100034', parentHasQtyMove: true },
    ]);
    expect([...os.keys()]).toEqual(['9194100034']);
    expect(os.get('9194100034')).toBe(3_200_000);
  });

  /*
   * THE CASE THAT BROKE THE FIRST VERSION. The parent is fully delivered, so its outstanding is 0
   * and it is absent from the map entirely; the child is an empty SAP duplicate that still shows
   * its whole quantity. 49 such pairs on the dev copy, 17,402 MT. A guard keyed on "parent > 0"
   * hands the family to the child and inflates outstanding by all of it.
   */
  it('drops the child even when the parent is fully delivered and carries no outstanding', () => {
    const os = new Map([['1004032094', 4_500_000]]);
    applyB2bParentPreference(os, [
      { child: '1004032094', origin: '9144101939', parentHasQtyMove: true },
    ]);
    expect(os.has('1004032094')).toBe(false);
  });

  it('keeps the child only when the parent has no movement record at all', () => {
    const os = new Map([['1004030568', 3_200_000]]);
    applyB2bParentPreference(os, [
      { child: '1004030568', origin: '9194100034', parentHasQtyMove: false },
    ]);
    expect(os.get('1004030568')).toBe(3_200_000);
  });

  it('leaves contracts with no B2B link alone', () => {
    const os = new Map([['C1', 100], ['C2', 200]]);
    applyB2bParentPreference(os, []);
    expect([...os.keys()].sort()).toEqual(['C1', 'C2']);
  });
});
