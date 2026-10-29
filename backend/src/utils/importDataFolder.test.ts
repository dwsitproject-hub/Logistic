import { describe, expect, it } from 'vitest';
import { IMPORT_DATA_FOLDER, importDataSubdir } from './fileUpload';

describe('importDataSubdir: the Quality / Shortage Claim workbooks live in IMPORT DATA on the share', () => {
  it('claim-mutu and claim-susut are subfolders of IMPORT DATA, and a manual import is kept in their manual folder', () => {
    expect(IMPORT_DATA_FOLDER).toBe('IMPORT DATA');
    expect(importDataSubdir('claim-mutu')).toBe('IMPORT DATA/claim-mutu');
    expect(importDataSubdir('claim-susut')).toBe('IMPORT DATA/claim-susut');
    expect(importDataSubdir('claim-mutu', 'manual')).toBe('IMPORT DATA/claim-mutu/manual');
    expect(importDataSubdir('claim-susut', 'manual')).toBe('IMPORT DATA/claim-susut/manual');
  });

  it('a name cannot climb out of it', () => {
    expect(importDataSubdir('../../etc')).toBe('IMPORT DATA/etc');
    expect(importDataSubdir('claim-mutu', '../..')).toBe('IMPORT DATA/claim-mutu/unassigned');
    expect(importDataSubdir('')).toBe('IMPORT DATA/unassigned');
  });
});
