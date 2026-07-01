import { describe, expect, it } from 'vitest';
import {
  buildDailyDeliverablesKgFromMtEntries,
  isUnplannedWidePlanningTemplateMatrix,
  parseUnplannedWidePlanningMatrix,
} from './truckingUnplannedPlanningUpload';

describe('truckingUnplannedPlanningUpload', () => {
  it('detects unplanned wide template headers', () => {
    expect(
      isUnplannedWidePlanningTemplateMatrix([
        ['Contract Ext No', 'PO', 'Outstanding Qty (MT)', '01/06/2026'],
      ]),
    ).toBe(true);
  });

  it('parses PO row and skips outstanding metadata column', () => {
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

  it('converts MT template qty to kg for daily_deliverables', () => {
    const kg = buildDailyDeliverablesKgFromMtEntries([
      { dateIso: '2026-06-01', qtyMt: 1.5 },
    ]);
    expect(kg).toEqual([{ date: '2026-06-01', quantity_delivered: 1500 }]);
  });
});
