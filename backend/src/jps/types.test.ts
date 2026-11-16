import { describe, expect, it } from 'vitest';
import { JPS_LIVE_STATUSES, JPS_LIVE_STATUSES_SQL } from './types';

describe('JPS statuses the poller keeps asking about', () => {
  it('includes Hose On and Hose Off: the production catalog (2026-11-16) has them as stages before Sailed Off, so a vessel there has not finished', () => {
    expect(JPS_LIVE_STATUSES).toEqual(
      expect.arrayContaining(['Pending', 'Approved', 'Allocated', 'Berthed', 'Hose On', 'Start Cargo', 'Cargo Done', 'Hose Off']),
    );
    expect(JPS_LIVE_STATUSES_SQL).toContain(`'Hose On'`);
    expect(JPS_LIVE_STATUSES_SQL).toContain(`'Hose Off'`);
  });

  it('leaves the terminal statuses out', () => {
    for (const s of ['Rejected', 'Deleted', 'Sailed Off', 'Sailed']) {
      expect(JPS_LIVE_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});
