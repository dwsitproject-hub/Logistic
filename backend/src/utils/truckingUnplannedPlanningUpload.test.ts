import { describe, expect, it } from 'vitest';
import {
  buildDailyDeliverablesKgFromMtEntries,
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
          'OS Qty',
          'Plan Qty',
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

  it('parses new template PO row and skips metadata columns', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      [
        'Group',
        'Supplier',
        'Source',
        'Contract Date',
        'Contract Ext No',
        'PO',
        'OS Qty',
        'Plan Qty',
        '1-Jun-2026',
        '2-Jun-2026',
      ],
      ['G1', 'Sup A', '3rd Party', '1-May-2026', 'EXT-1', '1001029994', '500', '', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].po_number).toBe('1001029994');
    expect(rows[0].contract_ext_no).toBe('EXT-1');
    expect(rows[0].entries).toHaveLength(2);
    expect(rows[0].entries[0].qtyMt).toBe(10);
    expect(rows[0].rawCells.length).toBeGreaterThan(0);
  });

  it('parses year-less D-MMM date column headers using reference year', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      ['Contract Ext No', 'PO', '1-Jun', '2-Jun'],
      ['EXT-1', '1001029994', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows[0].entries).toHaveLength(2);
    expect(rows[0].entries[0].dateIso).toMatch(/^\d{4}-06-01$/);
    expect(rows[0].entries[1].dateIso).toMatch(/^\d{4}-06-02$/);
  });

  it('parses legacy PO row and skips outstanding metadata column', () => {
    const { rows, rowParseFailures } = parseUnplannedWidePlanningMatrix([
      ['Contract Ext No', 'PO', 'Outstanding Qty (MT)', '01/06/2026', '02/06/2026'],
      ['EXT-1', '1001029994', '500', '10', '20'],
    ]);
    expect(rowParseFailures).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].po_number).toBe('1001029994');
    expect(rows[0].entries).toHaveLength(2);
    expect(rows[0].entries[0].qtyMt).toBe(10);
  });

  it('converts template qty kg to daily_deliverables', () => {
    const kg = buildDailyDeliverablesKgFromMtEntries([
      { dateIso: '2026-06-01', qtyMt: 1500 },
    ]);
    expect(kg).toEqual([{ date: '2026-06-01', quantity_delivered: 1500 }]);
  });
});
