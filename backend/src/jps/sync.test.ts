import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  isJpsEnabled: vi.fn(() => true),
  jpsAutoSubmit: vi.fn(() => true),
  jpsEnabledPortNames: vi.fn(() => []),
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
import { jpsAutoSubmit } from './config';
import { pollSubmittedInstructions } from './poll';
import { submitEligibleStos } from './submit';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import { runJpsSync } from './index';

function sweep(opts: { submitted?: number; recovered?: number; changed?: number; held?: number; failed?: number; listChanged?: number }) {
  vi.mocked(submitEligibleStos).mockResolvedValue({
    considered: 1,
    submitted: opts.submitted ?? 0,
    recovered: opts.recovered ?? 0,
    held: opts.held ?? 0,
    failed: opts.failed ?? 0,
    listChanged: opts.listChanged ?? 0,
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

  it('clears it when an STO has just failed or been held, so its badge stops reading Not Sent', async () => {
    sweep({ failed: 1, listChanged: 1 });
    await runJpsSync('shipment-edit');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);

    vi.mocked(invalidateShipmentsListCache).mockClear();
    sweep({ held: 1, listChanged: 1 });
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone when a held or failed STO is looked at again and nothing about it changed', async () => {
    sweep({ held: 3, failed: 1, listChanged: 0 });
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).not.toHaveBeenCalled();
  });

  it('leaves the cache alone on a sweep where nothing visible changed', async () => {
    sweep({});
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).not.toHaveBeenCalled();
  });
});

// From 2026-10-30 nothing is sent to JPS on its own unless Integrations > JPS > Send automatically is true: a user presses Submit to Jetty.
describe('runJpsSync with Send automatically off', () => {
  beforeEach(() => {
    vi.mocked(submitEligibleStos).mockClear();
    vi.mocked(amendPendingInstructions).mockClear();
    vi.mocked(pollSubmittedInstructions).mockClear();
    vi.mocked(invalidateShipmentsListCache).mockClear();
  });

  it('sends nothing, for any reason (SAP import, shipment edit, schedule), but still amends and polls what JPS already holds', async () => {
    vi.mocked(jpsAutoSubmit).mockReturnValue(false);
    sweep({});
    for (const reason of ['sap-import', 'shipment-edit', 'ata-override', 'cron']) await runJpsSync(reason);
    expect(submitEligibleStos).not.toHaveBeenCalled();
    expect(amendPendingInstructions).toHaveBeenCalledTimes(4);
    expect(pollSubmittedInstructions).toHaveBeenCalledTimes(4);
  });

  it('a status JPS changed still clears the list cache', async () => {
    vi.mocked(jpsAutoSubmit).mockReturnValue(false);
    sweep({ changed: 1 });
    await runJpsSync('cron');
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);
  });

  it('with it on, the sweep sends as before', async () => {
    vi.mocked(jpsAutoSubmit).mockReturnValue(true);
    sweep({ submitted: 1 });
    await runJpsSync('cron');
    expect(submitEligibleStos).toHaveBeenCalledTimes(1);
  });
});
