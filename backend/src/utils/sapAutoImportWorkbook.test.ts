import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  writeSapAutoImportFailedWorkbook,
  writeSapAutoImportSuccessWorkbook,
} from './sapAutoImportWorkbook';
import type { SapAutoImportIdentityRow } from './sapAutoImportIdentity';

const sample: SapAutoImportIdentityRow = {
  contractDate: '2026-08-01',
  contractNumber: 'CTR-1',
  contractExtNo: 'EXT-1',
  poNumber: '1581000001',
  stoNumber: '1006010001',
  supplier: 'PT Supplier',
  remarks: 'Row 2: missing PO',
};

describe('sapAutoImportWorkbook', () => {
  it('writes Success columns and does not create an empty file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-wb-'));
    const successPath = path.join(dir, 'ok.xlsx');
    const emptyPath = path.join(dir, 'empty.xlsx');

    expect(writeSapAutoImportSuccessWorkbook(successPath, [sample])).toBe(true);
    expect(writeSapAutoImportSuccessWorkbook(emptyPath, [])).toBe(false);
    expect(fs.existsSync(emptyPath)).toBe(false);

    const wb = XLSX.readFile(successPath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as string[][];
    expect(rows[0]).toEqual(['Contract Date', 'Contract', 'Contract Ext No', 'PO', 'STO', 'Supplier']);
    expect(rows[1]).toEqual([
      '2026-08-01',
      'CTR-1',
      'EXT-1',
      '1581000001',
      '1006010001',
      'PT Supplier',
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes Failed workbook with Remarks and skips empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-wb-'));
    const failedPath = path.join(dir, 'bad.xlsx');
    expect(writeSapAutoImportFailedWorkbook(failedPath, [sample])).toBe(true);
    expect(writeSapAutoImportFailedWorkbook(path.join(dir, 'none.xlsx'), [])).toBe(false);

    const wb = XLSX.readFile(failedPath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as string[][];
    expect(rows[0]?.[6]).toBe('Remarks');
    expect(rows[1]?.[6]).toBe('Row 2: missing PO');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
