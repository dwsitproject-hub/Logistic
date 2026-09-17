import { describe, expect, it } from 'vitest';
import { rowMatchesContractPerfStatusFilter } from './latePerformance.service';

describe('rowMatchesContractPerfStatusFilter', () => {
  it('includes all rows when status filter is empty or All', () => {
    expect(rowMatchesContractPerfStatusFilter({ status: 'OPEN' }, '')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ status: 'CLOSE' }, 'All')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ status: 'CLOSE' }, 'All Status')).toBe(true);
  });

  it('Open filter matches OPEN/ACTIVE import or raw status', () => {
    expect(rowMatchesContractPerfStatusFilter({ import_status: 'Open' }, 'Open')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ status: 'ACTIVE' }, 'Open')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ import_status: 'Close' }, 'Open')).toBe(false);
  });

  it('Close filter matches CLOSE/CLOSED/COMPLETED', () => {
    expect(rowMatchesContractPerfStatusFilter({ import_status: 'Close' }, 'Close')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ status: 'COMPLETED' }, 'Close')).toBe(true);
    expect(rowMatchesContractPerfStatusFilter({ status: 'OPEN' }, 'Close')).toBe(false);
  });
});
