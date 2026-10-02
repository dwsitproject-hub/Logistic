import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  isJpsEnabled: vi.fn(() => true),
  jpsRegionSite: vi.fn(),
  jpsRetryFailed: vi.fn(),
  jpsSweepCron: vi.fn(),
}));
vi.mock('./submit', () => ({ submitEligibleStos: vi.fn() }));
vi.mock('./amend', () => ({ amendPendingInstructions: vi.fn(), buildJpsAmendBody: vi.fn() }));
vi.mock('./poll', () => ({ pollSubmittedInstructions: vi.fn() }));
vi.mock('./eligibility', () => ({ findEligibleStos: vi.fn() }));
vi.mock('../services/shipmentList.service', () => ({ invalidateShipmentsListCache: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { amendPendingInstructions } from './amend';
import { pollSubmittedInstructions } from './poll';
import { submitEligibleStos } from './submit';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import { runJpsSync } from './index';

function sweep(opts: { submitted?: number; recovered?: number; changed?: number }) {
  vi.mocked(submitEligibleStos).mockResolvedValue({
    considered: 1,
    submitted: opts.submitted ?? 0,
    recovered: opts.recovered ?? 0,
    held: 0,
    failed: 0,
  });
  vi.mocked(amendPendingInstructions).mockResolvedValue({ checked: 0, amended: 0, unchanged: 0, blocked: 0, failed: 0 });
  vi.mocked(pollSubmittedInstructions).mockResolvedValue({ polled: 1, changed: opts.changed ?? 0, errors: 0 });
}

// JPS approved an instruction and the Shipments list went on showing the old status: the poller wrote the new status
// to jps_shipping_instructions, and nothing cleared the list pages the browser was being served (an hour of cache).
describe('runJpsSync and the Shipments list cache', () => {
  beforeEach(() => {
    vi.mocked(invalidateShipmentsListCache).mockClear();
  });

  it('clears the list cache when JPS changed a status', async () => {
    sweep({ changed: 1 });
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);
  });

  it('clears it when an instruction was just sent, or recovered after a lost reply', async () => {
    sweep({ submitted: 1 });
    await runJpsSync('shipment-edit');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);

    vi.mocked(invalidateShipmentsListCache).mockClear();
    sweep({ recovered: 1 });
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone on a sweep where nothing visible changed', async () => {
    sweep({});
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).not.toHaveBeenCalled();
  });
});
