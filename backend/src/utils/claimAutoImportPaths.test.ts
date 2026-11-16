import { afterEach, describe, expect, it } from 'vitest';
import {
  claimAutoImportFilePattern,
  isClaimAutoImportFile,
  jakartaDateOfMtime,
  pickNewestClaimFile,
} from './claimAutoImportPaths';

afterEach(() => {
  delete process.env.CLAIM_AUTO_IMPORT_FILE_PATTERN;
});

describe('isClaimAutoImportFile', () => {
  it('takes the OSCLAIM export, in any case, as .xls or .xlsx', () => {
    expect(isClaimAutoImportFile('OSCLAIM_ALLREGION_MUTU SUSUT_JAN S.D OKT 2026.xls')).toBe(true);
    expect(isClaimAutoImportFile('osclaim_allregion.XLSX')).toBe(true);
  });
  it('leaves other files in the folder alone', () => {
    expect(isClaimAutoImportFile('REALCLAIM_ALLREGION.xls')).toBe(false);
    expect(isClaimAutoImportFile('OSCLAIM.csv')).toBe(false);
    expect(isClaimAutoImportFile('~$OSCLAIM_ALLREGION.xlsx')).toBe(false);
    expect(isClaimAutoImportFile('Thumbs.db')).toBe(false);
  });
  it('follows CLAIM_AUTO_IMPORT_FILE_PATTERN, and falls back to the default when it is not a valid expression', () => {
    process.env.CLAIM_AUTO_IMPORT_FILE_PATTERN = '^CLAIM_ALL';
    expect(isClaimAutoImportFile('CLAIM_ALL_2026.xlsx')).toBe(true);
    expect(isClaimAutoImportFile('OSCLAIM_ALLREGION.xls')).toBe(false);
    process.env.CLAIM_AUTO_IMPORT_FILE_PATTERN = '([';
    expect(claimAutoImportFilePattern().source).toBe('^OSCLAIM');
  });
});

describe('pickNewestClaimFile', () => {
  it('takes the newest by modification time and is null for an empty folder', () => {
    expect(pickNewestClaimFile([])).toBeNull();
    expect(
      pickNewestClaimFile([
        { fileName: 'a.xls', mtimeMs: 1 },
        { fileName: 'b.xls', mtimeMs: 3 },
        { fileName: 'c.xls', mtimeMs: 2 },
      ])?.fileName,
    ).toBe('b.xls');
  });
});

describe('jakartaDateOfMtime', () => {
  it('uses the Jakarta calendar day, not the UTC one', () => {
    expect(jakartaDateOfMtime(Date.UTC(2026, 10, 11, 23, 30))).toBe('2026-11-12');
    expect(jakartaDateOfMtime(Date.UTC(2026, 10, 12, 16, 59))).toBe('2026-11-12');
    expect(jakartaDateOfMtime(Date.UTC(2026, 10, 12, 17, 0))).toBe('2026-11-13');
  });
});
