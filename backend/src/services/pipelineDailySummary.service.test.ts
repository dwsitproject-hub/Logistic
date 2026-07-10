import { describe, expect, it } from 'vitest';
import { isPipelineDailySummaryEligible } from './pipelineDailySummary.service';

describe('isPipelineDailySummaryEligible', () => {
  it('allows date range + plants only', () => {
    expect(
      isPipelineDailySummaryEligible({
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
        plants: ['PRC Karawang'],
      }),
    ).toBe(true);
  });

  it('rejects global search', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        globalSearch: 'ABC',
      }),
    ).toBe(false);
  });

  it('rejects column filters other than toolbar product/incoterm', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        colFilters: { supplier: { type: 'multi', values: ['ACME'] } },
      }),
    ).toBe(false);
  });

  it('allows product toolbar column filter', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        colFilters: { product: { type: 'multi', values: ['CPO'] } },
      }),
    ).toBe(true);
  });

  it('allows incoterm toolbar column filter', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        colFilters: { incoterm: { type: 'multi', values: ['FRC'] } },
      }),
    ).toBe(true);
  });

  it('rejects pipeline status card filter', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        status: 'PLANNED',
      }),
    ).toBe(false);
  });

  it('rejects scopeStatus on summary cards', () => {
    expect(
      isPipelineDailySummaryEligible({
        plants: [],
        scopeStatus: 'AT_LOADING_PORT',
      }),
    ).toBe(false);
  });
});
