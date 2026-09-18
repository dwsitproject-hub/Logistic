import { describe, expect, it, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above every other statement, so the spies have to be created inside
// vi.hoisted or the factory closes over a variable that does not exist yet.
const spies = vi.hoisted(() => ({
  list: vi.fn(),
  perf: vi.fn(),
  cp: vi.fn(),
}));

vi.mock('./shipmentList.service', () => ({ invalidateShipmentsListCache: spies.list }));
vi.mock('./shippingPerformance.service', () => ({ invalidateShippingPerformanceRowCache: spies.perf }));
vi.mock('./contractPerformanceSnapshot.service', () => ({
  scheduleContractPerformanceRefreshForShipments: spies.cp,
}));

import { invalidateAfterShipmentWrite } from './shipmentWriteInvalidation.service';

describe('invalidateAfterShipmentWrite', () => {
  beforeEach(() => {
    spies.list.mockClear();
    spies.perf.mockClear();
    spies.cp.mockClear();
  });

  it('always clears BOTH caches - the drift this replaced left Shipping Performance stale', () => {
    invalidateAfterShipmentWrite();
    expect(spies.list).toHaveBeenCalledTimes(1);
    expect(spies.perf).toHaveBeenCalledTimes(1);
  });

  it('refreshes Contract Performance for every id it is given', () => {
    invalidateAfterShipmentWrite(['a', 'b']);
    expect(spies.cp).toHaveBeenCalledWith(['a', 'b']);
  });

  it('skips the per-shipment refresh when no ids are known, without skipping the caches', () => {
    // A pre-planned rebuild reshapes many groups and has no single id list. Skipping that refresh
    // is correct; silently skipping the two caches as well was the bug.
    invalidateAfterShipmentWrite();
    expect(spies.cp).not.toHaveBeenCalled();
    expect(spies.list).toHaveBeenCalledTimes(1);
    expect(spies.perf).toHaveBeenCalledTimes(1);
  });

  it('ignores blank ids rather than scheduling a refresh for nothing', () => {
    invalidateAfterShipmentWrite(['', '  ']);
    expect(spies.cp).not.toHaveBeenCalled();
  });
});
