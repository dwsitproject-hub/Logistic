import { describe, expect, it } from 'vitest';
import {
  isPipelineDailySummaryEligible,
  isPipelineDailySummaryMetaFresh,
  isPipelineDailySummaryMetaUsable,
  SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION,
} from './pipelineDailySummary.service';

describe('isPipelineDailySummaryEligible', () => {
  it('allows a date range on its own', () => {
    expect(
      isPipelineDailySummaryEligible({
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
        plants: [],
      }),
    ).toBe(true);
  });

  /**
   * This assertion used to read `plants: ['PRC Karawang'] -> true`, and that assumption is what
   * emptied the Trucking page for a Region/Plant filter.
   *
   * The toolbar's options are DISTINCT SAP Discharge Destination; the snapshot's `group_plant` is
   * `groupPlantExpr('c.plant_code', 'c.company_name')` - the master_plants grouping. Two
   * dimensions. On the dev database the dropdown offers 40 values, the snapshot holds 11, and
   * only 4 overlap (BEKASI, BONTANG, KARAWANG, TANJUNG PURA) - and even those failed, because
   * `appendGroupPlantFilter` compares case-sensitively: `BONTANG` matched 0 rows against the
   * stored `Bontang` (2,237), `TANJUNG PURA` 0 against `Tanjung Pura` (4,866).
   *
   * Note the old fixture value: `PRC Karawang` is not a value either side ever produces, which is
   * a fair sign the case was written from assumption rather than from the data.
   */
  it('rejects a Region/Plant filter - the snapshot stores a different dimension', () => {
    expect(
      isPipelineDailySummaryEligible({
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
        plants: ['BONTANG'],
      }),
    ).toBe(false);
  });

  it('rejects it whatever the spelling, since the fix is not about case', () => {
    for (const plant of ['Bontang', 'BONTANG', 'TANJUNG PURA', 'PALEMBANG']) {
      expect(
        isPipelineDailySummaryEligible({ dateFrom: '2026-01-01', dateTo: '2026-06-30', plants: [plant] }),
      ).toBe(false);
    }
  });

  /**
   * Migration 164 gives `trucking_list_stage_snapshot` a `region_site` column written from the
   * live filter's own expression, so the loaders reading *that* table can serve a Region/Plant
   * filter. Verified before the flag was wired: across all 39 region_site values plus the
   * unfiltered case, snapshot and live execution counts agreed on 40 of 40, and Section 1's 22
   * figures agreed exactly for no filter, BONTANG and TANJUNG PURA.
   *
   * The flag is a caller's declaration, not a bypass - each loader re-checks that the column is
   * actually populated before trusting it.
   */
  it('allows a plant filter only for a caller that declares the region_site table', () => {
    const filters = { dateFrom: '2026-01-01', dateTo: '2026-06-30', plants: ['BONTANG'] };
    expect(isPipelineDailySummaryEligible(filters, { allowPlantFilter: true })).toBe(true);
    expect(isPipelineDailySummaryEligible(filters)).toBe(false);
  });

  it('the flag does not loosen any other rule', () => {
    expect(
      isPipelineDailySummaryEligible(
        { dateFrom: '2026-01-01', dateTo: '2026-06-30', plants: ['BONTANG'], globalSearch: 'abc' },
        { allowPlantFilter: true },
      ),
    ).toBe(false);
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

describe('isPipelineDailySummaryMetaUsable / Fresh', () => {
  it('rejects missing meta', () => {
    expect(isPipelineDailySummaryMetaUsable(null, 'shipment')).toBe(false);
    expect(isPipelineDailySummaryMetaFresh(null, 'shipment')).toBe(false);
  });

  it('rejects outdated logic version even when not stale', () => {
    expect(
      isPipelineDailySummaryMetaUsable(
        { is_stale: false, logic_version: SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION - 1 },
        'shipment',
      ),
    ).toBe(false);
  });

  it('treats current-version stale snapshot as usable but not fresh', () => {
    const stale = { is_stale: true, logic_version: SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION };
    expect(isPipelineDailySummaryMetaUsable(stale, 'shipment')).toBe(true);
    expect(isPipelineDailySummaryMetaFresh(stale, 'shipment')).toBe(false);
  });

  it('treats current-version non-stale snapshot as fresh', () => {
    const fresh = { is_stale: false, logic_version: SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION };
    expect(isPipelineDailySummaryMetaUsable(fresh, 'shipment')).toBe(true);
    expect(isPipelineDailySummaryMetaFresh(fresh, 'shipment')).toBe(true);
  });
});
