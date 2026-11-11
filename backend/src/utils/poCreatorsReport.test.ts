import { afterEach, describe, expect, it } from 'vitest';
import { isPoCreatorsReportFile, pickNewestReport, readPoCreators } from './poCreatorsReport';

const HEAD = ['Purchasing Document', 'Plant', 'Created by', 'Deletion indicator'];

describe('readPoCreators', () => {
  it('reads one creator per PO from a report with one row per item', () => {
    const r = readPoCreators([HEAD, ['1001', 'EU51', '04124040143', ''], ['1001', 'EU51', '04124040143', ''], ['1002', 'EU22', 62237590905, '']]);
    expect(r?.rows).toEqual([
      { po_number: '1001', created_by: '04124040143' },
      { po_number: '1002', created_by: '62237590905' },
    ]);
    expect(r).toMatchObject({ creators: 2, conflicts: 0, skipped: 0 });
  });
  it('keeps the first creator of a PO and counts a PO with two creators once', () => {
    const r = readPoCreators([HEAD, ['1001', '', 'A', ''], ['1001', '', 'B', ''], ['1001', '', 'C', '']]);
    expect(r?.rows).toEqual([{ po_number: '1001', created_by: 'A' }]);
    expect(r?.conflicts).toBe(1);
  });
  it('skips half-empty rows, ignores blank ones, and is null without the two columns', () => {
    const r = readPoCreators([HEAD, ['1001', '', '', ''], ['', '', 'A', ''], ['', '', '', ''], ['1002', '', 'A', '']]);
    expect(r?.rows).toEqual([{ po_number: '1002', created_by: 'A' }]);
    expect(r?.skipped).toBe(2);
    expect(readPoCreators([['PO', 'Plant'], ['1', 'x']])).toBeNull();
  });
});

describe('which file is the ME2N report', () => {
  afterEach(() => {
    delete process.env.PO_CREATORS_FILE_PATTERN;
  });
  it('matches the ME2N workbook and never the daily export or its halves', () => {
    expect(isPoCreatorsReportFile('ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx')).toBe(true);
    expect(isPoCreatorsReportFile('me2n  from 01 Jan 2026 to 12 Nov 2026.XLSX')).toBe(true);
    expect(isPoCreatorsReportFile('ZMMLOG_RPT from 01 Jan 2026 to 11 Nov 2026.xlsx')).toBe(false);
    expect(isPoCreatorsReportFile('Part 1ZMMLOG_RPT from 01 Jan 2026.xlsx')).toBe(false);
    expect(isPoCreatorsReportFile('~$ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx')).toBe(false);
    expect(isPoCreatorsReportFile('ME2N from 01 Jan 2026 to 11 Nov 2026.csv')).toBe(false);
  });
  it('takes the pattern from PO_CREATORS_FILE_PATTERN when SAP renames the report', () => {
    process.env.PO_CREATORS_FILE_PATTERN = '^Purchasing\\s+report';
    expect(isPoCreatorsReportFile('Purchasing report 2026.xlsx')).toBe(true);
    expect(isPoCreatorsReportFile('ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx')).toBe(false);
  });
  it('picks the newest file, and the name breaks a tie', () => {
    expect(pickNewestReport([])).toBeNull();
    expect(pickNewestReport([{ fileName: 'a', mtimeMs: 1 }, { fileName: 'b', mtimeMs: 3 }, { fileName: 'c', mtimeMs: 2 }])?.fileName).toBe('b');
    expect(pickNewestReport([{ fileName: 'ME2N 9', mtimeMs: 5 }, { fileName: 'ME2N 10', mtimeMs: 5 }])?.fileName).toBe('ME2N 10');
  });
});
