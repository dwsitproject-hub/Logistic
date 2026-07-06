import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  aggregateWbRekapTickets,
  findWbRekapHeaderRowIndex,
  parseWbRekapSheetMatrix,
  parseWbRekapWorkbook,
  resolveWbActualQtyKg,
  WB_REKAP_SHEET_TO_KLIP_PRODUCT,
} from './truckingWbRekapUpload';
import { toIsoDate10FromCell } from './planningSheetDate';

const parseDate = (raw: unknown): string | null => {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
};

describe('truckingWbRekapUpload', () => {
  it('maps all sample workbook sheets to KLIP products', () => {
    const sampleSheets = [
      'CPO',
      'CPO-RSPO',
      'CPKO',
      'POME',
      'PK_KEBUN',
      'PK_KAPAL',
      'CANGKANG',
      'CANGKANG KAPAL',
      'PKE KEBUN',
      'CANGKANG_KAPAL_GGL',
    ];
    for (const sheet of sampleSheets) {
      expect(WB_REKAP_SHEET_TO_KLIP_PRODUCT[sheet]).toBeTruthy();
    }
  });

  it('finds header row with PO/SO and Tanggal Masuk', () => {
    const matrix = [
      ['', 'DAILY REPORT'],
      ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
      [1, '1001029784', '01/06/2026', 17200, 17140],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(1);
  });

  it('parses ticket rows and aggregates by PO + date', () => {
    const matrix = [
      ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
      [1, '1001029784', '01/06/2026', 17200, 17140],
      [2, '1001029784', '01/06/2026', 17350, 17310],
      [3, '1001030126', '02/06/2026', 17120, 17110],
    ];
    const { tickets } = parseWbRekapSheetMatrix('CPO', matrix, parseDate);
    expect(tickets).toHaveLength(3);
    const aggregated = aggregateWbRekapTickets(tickets);
    expect(aggregated).toHaveLength(2);
    const po1 = aggregated.find((a) => a.poNumber === '1001029784');
    expect(po1?.sumNettoPksKg).toBe(34550);
    expect(po1?.sumNettoEupKg).toBe(34450);
    expect(po1?.ticketCount).toBe(2);
  });

  it('skips unmapped sheets in workbook parse', () => {
    const result = parseWbRekapWorkbook(
      [
        {
          sheetName: 'UNKNOWN_PRODUCT',
          matrix: [['PO/SO', 'Tanggal Masuk'], ['PO-1', '01/06/2026']],
        },
        {
          sheetName: 'POME',
          matrix: [
            ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
            [1, '1001029508', '03/06/2026', 8080, 8100],
          ],
        },
      ],
      parseDate,
    );
    expect(result.sheetsSkipped).toHaveLength(1);
    expect(result.sheetsSkipped[0]?.sheetName).toBe('UNKNOWN_PRODUCT');
    expect(result.sheetsProcessed).toEqual(['POME']);
    expect(result.aggregated).toHaveLength(1);
  });

  it('resolves qty by incoterm LCO vs FRC', () => {
    expect(resolveWbActualQtyKg('LCO', 1000, 900)).toEqual({ ok: true, quantityKg: 1000 });
    expect(resolveWbActualQtyKg('FRC', 1000, 900)).toEqual({ ok: true, quantityKg: 900 });
    expect(resolveWbActualQtyKg('FOB', 1000, 900).ok).toBe(false);
  });

  it('parses sample WB rekap workbook CPO sheet when file is present', () => {
    const samplePath = path.resolve(
      __dirname,
      '../../../docs/Rekap INCOMING TIMB-EUP-BTG JUNI 2026.xlsx',
    );
    if (!fs.existsSync(samplePath)) return;

    const buf = fs.readFileSync(samplePath);
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets['CPO'];
    expect(ws).toBeTruthy();
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(8);

    const { tickets } = parseWbRekapSheetMatrix('CPO', matrix, toIsoDate10FromCell);
    expect(tickets.length).toBeGreaterThan(100);
    const aggregated = aggregateWbRekapTickets(tickets);
    expect(aggregated.length).toBeGreaterThan(0);
    expect(aggregated.some((a) => a.poNumber === '1001029784')).toBe(true);
  });
});
