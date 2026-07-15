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
  it('keeps optional legacy sheet→product hint map for known names', () => {
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
    expect(tickets[0]?.klipProduct).toBe('CPO');
    const aggregated = aggregateWbRekapTickets(tickets);
    expect(aggregated).toHaveLength(2);
    const po1 = aggregated.find((a) => a.poNumber === '1001029784');
    expect(po1?.sumNettoPksKg).toBe(34550);
    expect(po1?.sumNettoEupKg).toBe(34450);
    expect(po1?.ticketCount).toBe(2);
  });

  it('parses sheets by PO header even when sheet name is not in the legacy product map', () => {
    const result = parseWbRekapWorkbook(
      [
        {
          sheetName: 'UNKNOWN_PRODUCT',
          matrix: [
            ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
            [1, 'PO-1', '01/06/2026', 1000, 950],
          ],
        },
        {
          sheetName: 'POME',
          matrix: [
            ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
            [1, '1001029508', '03/06/2026', 8080, 8100],
          ],
        },
        {
          sheetName: 'README',
          matrix: [['Notes'], ['No WB columns here']],
        },
      ],
      parseDate,
    );
    expect(result.sheetsProcessed).toEqual(['UNKNOWN_PRODUCT', 'POME']);
    expect(result.sheetsSkipped.map((s) => s.sheetName)).toEqual(['README']);
    expect(result.aggregated).toHaveLength(2);
    expect(result.tickets.find((t) => t.sheetName === 'UNKNOWN_PRODUCT')?.klipProduct).toBeNull();
  });

  it('resolves qty by incoterm LCO vs FRC and soft-warns when OS side is zero', () => {
    expect(resolveWbActualQtyKg('LCO', 1000, 900)).toEqual({ ok: true, quantityKg: 1000 });
    expect(resolveWbActualQtyKg('FRC', 1000, 900)).toEqual({ ok: true, quantityKg: 900 });
    expect(resolveWbActualQtyKg('FOB', 1000, 900).ok).toBe(false);

    const lcoComplementary = resolveWbActualQtyKg('LCO', 0, 900);
    expect(lcoComplementary.ok).toBe(true);
    if (lcoComplementary.ok) {
      expect(lcoComplementary.quantityKg).toBe(0);
      expect(lcoComplementary.softWarning).toBeTruthy();
    }

    const frcComplementary = resolveWbActualQtyKg('FRC', 1000, 0);
    expect(frcComplementary.ok).toBe(true);
    if (frcComplementary.ok) {
      expect(frcComplementary.quantityKg).toBe(0);
      expect(frcComplementary.softWarning).toBeTruthy();
    }
  });

  it('parses all sheets from sample WB rekap workbook when file is present', () => {
    const samplePath = path.resolve(
      __dirname,
      '../../../docs/Rekap INCOMING TIMB-EUP-BTG JUNI 2026.xlsx',
    );
    if (!fs.existsSync(samplePath)) return;

    const buf = fs.readFileSync(samplePath);
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sheets = wb.SheetNames.map((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        raw: true,
      }) as unknown[][];
      return { sheetName, matrix };
    });

    const result = parseWbRekapWorkbook(sheets, toIsoDate10FromCell);
    // Every named sheet in the sample is either processed or skipped for structure — none for product name.
    expect(result.sheetsProcessed.length + result.sheetsSkipped.length).toBe(wb.SheetNames.length);
    expect(result.sheetsProcessed.length).toBeGreaterThan(0);
    expect(result.rawTicketRows).toBeGreaterThan(100);

    const cpoSheet = sheets.find((s) => s.sheetName === 'CPO');
    expect(cpoSheet).toBeTruthy();
    expect(findWbRekapHeaderRowIndex(cpoSheet!.matrix)).toBe(8);
    expect(result.aggregated.some((a) => a.poNumber === '1001029784')).toBe(true);
  });
});
