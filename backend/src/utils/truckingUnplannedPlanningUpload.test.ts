import { describe, expect, it } from 'vitest';
import {
  buildDailyDeliverablesKgFromMtEntries,
  collectEffectivePlanningClearDates,
  collectLockedActualDates,
  isUnplannedWidePlanningTemplateMatrix,
  parseUnplannedWidePlanningMatrix,
} from './truckingUnplannedPlanningUpload';

describe('truckingUnplannedPlanningUpload', () => {
  it('detects new unplanned wide template headers', () => {
    expect(
      isUnplannedWidePlanningTemplateMatrix([
        [
          'Group',
          'Supplier',
          'Source',
          'Contract Date',
          'Contract Ext No',
          'PO',
          'OS Qty (MT)',
          'Plan Qty (MT)',
          '1-Jun-2026',
        ],
      ]),
    ).toBe(true);
  });

  it('detects legacy unplanned wide template headers', () => {
    expect(
      isUnplannedWidePlanningTemplateMatrix([
        ['Contract Ext No', 'PO', 'Outstanding Qty (MT)', '01/06/2026'],
      ]),
    ).toBe(true);
  });

  it('parses new template PO row with Status column and skips metadata', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      [
        'Group',
        'Supplier',
        'Source',
        'Contract Date',
        'Contract Ext No',
        'PO',
        'Status',
        'OS Qty (MT)',
        'Plan Qty (MT)',
        '1-Jun-2026',
        '2-Jun-2026',
      ],
      [
        'G1',
        'Sup A',
        '3rd Party',
        '1-May-2026',
        'EXT-1',
        '1001029994',
        'Unplanned',
        '0.5',
        '',
        '10',
        '20',
      ],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].po_number).toBe('1001029994');
    expect(rows[0].contract_ext_no).toBe('EXT-1');
    const setEntries = rows[0].entries.filter((e) => e.qtyMt != null);
    expect(setEntries).toHaveLength(2);
    expect(setEntries[0].qtyMt).toBe(10000);
    expect(setEntries[1].qtyMt).toBe(20000);
  });

  it('parses blank date cells as clear candidates (qtyMt null)', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      ['Contract Ext No', 'PO', '1-Jun-2026', '2-Jun-2026'],
      ['EXT-1', '1001029994', '125', ''],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows[0].entries).toEqual([
      { dateIso: '2026-06-01', qtyMt: 125000, lineNumber: 2 },
      { dateIso: '2026-06-02', qtyMt: null, lineNumber: 2 },
    ]);
  });

  it('collectEffectivePlanningClearDates only clears dates that already exist', () => {
    const clears = collectEffectivePlanningClearDates(
      [
        { dateIso: '2026-07-22', qtyMt: null },
        { dateIso: '2026-07-23', qtyMt: null },
        { dateIso: '2026-07-24', qtyMt: 1000 },
      ],
      [
        { date: '2026-07-22', quantity_delivered: 125000 },
        { date: '2026-07-24', quantity_delivered: 5000 },
      ],
    );
    expect(clears).toEqual(['2026-07-22']);
  });

  it('collectLockedActualDates returns ISO dates from daily_actuals', () => {
    expect(
      collectLockedActualDates([
        { date: '2026-08-01', quantity_delivered: 10000 },
        { progress_date: '2026-08-02' },
      ]),
    ).toEqual(new Set(['2026-08-01', '2026-08-02']));
  });

  it('parses new template PO row and skips metadata columns', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      [
        'Group',
        'Supplier',
        'Source',
        'Contract Date',
        'Contract Ext No',
        'PO',
        'OS Qty (MT)',
        'Plan Qty (MT)',
        '1-Jun-2026',
        '2-Jun-2026',
      ],
      ['G1', 'Sup A', '3rd Party', '1-May-2026', 'EXT-1', '1001029994', '0.5', '', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].po_number).toBe('1001029994');
    expect(rows[0].contract_ext_no).toBe('EXT-1');
    const setEntries = rows[0].entries.filter((e) => e.qtyMt != null);
    expect(setEntries).toHaveLength(2);
    expect(setEntries[0].qtyMt).toBe(10000);
    expect(setEntries[1].qtyMt).toBe(20000);
    expect(rows[0].rawCells.length).toBeGreaterThan(0);
  });

  it('parses year-less D-MMM date column headers using reference year', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      ['Contract Ext No', 'PO', '1-Jun', '2-Jun'],
      ['EXT-1', '1001029994', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    const setEntries = rows[0].entries.filter((e) => e.qtyMt != null);
    expect(setEntries).toHaveLength(2);
    expect(setEntries[0].dateIso).toMatch(/^\d{4}-06-01$/);
    expect(setEntries[1].dateIso).toMatch(/^\d{4}-06-02$/);
  });

  it('parses legacy PO row and skips outstanding metadata column', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      ['Contract Ext No', 'PO', 'Outstanding Qty (MT)', '01/06/2026', '02/06/2026'],
      ['EXT-1', '1001029994', '0.5', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].po_number).toBe('1001029994');
    const setEntries = rows[0].entries.filter((e) => e.qtyMt != null);
    expect(setEntries).toHaveLength(2);
    expect(setEntries[0].qtyMt).toBe(10000);
    expect(setEntries[1].qtyMt).toBe(20000);
  });

  it('parses legacy kg template headers without MT conversion', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      [
        'Group',
        'Supplier',
        'Source',
        'Contract Date',
        'Contract Ext No',
        'PO',
        'OS Qty (kg)',
        'Plan Qty (kg)',
        '1-Jun-2026',
      ],
      ['G1', 'Sup A', '3rd Party', '1-May-2026', 'EXT-1', '1001029994', '500', '', '25000'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    const setEntries = rows[0].entries.filter((e) => e.qtyMt != null);
    expect(setEntries[0].qtyMt).toBe(25000);
  });

  it('converts template qty kg to daily_deliverables', () => {
    const kg = buildDailyDeliverablesKgFromMtEntries([
      { dateIso: '2026-06-01', qtyMt: 1500 },
    ]);
    expect(kg).toEqual([{ date: '2026-06-01', quantity_delivered: 1500 }]);
  });
});
