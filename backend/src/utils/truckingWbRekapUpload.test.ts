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
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (m2) {
    const yy = Number(m2[3]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
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

  it('finds SPC header with No PO/STO and TANGGAL', () => {
    const matrix = [
      ['REKAP TIMBANGAN'],
      ['No.', 'TANGGAL', 'No PO/STO', 'Timbangan Kebun', '', '', '', 'Timbangan SPC(kg)'],
      ['', '', '', 'Keluar', 'Masuk', 'Netto', 'TOTAL', 'Masuk', 'Keluar', 'Netto'],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(1);
  });

  it('finds Tj Pura header with NO PO and Tanggal Laporan', () => {
    const matrix = [
      ['PERIODE : JULI 2026'],
      [],
      [
        'No.',
        'TX',
        'No Ref',
        'Tanggal Laporan',
        'Tanggal Pengiriman',
        'Nomor DO',
        'NO KONTRAK',
        'NO PO',
        'NO STO',
        'Pihak Ketiga',
        '',
        '',
        'Pabrik',
        '',
        '',
      ],
      ['', '', '', '', '', '', '', '', '', 'Berat Kotor', 'Tare', 'NETT', 'Berat Kotor', 'Tare', 'NETT'],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(2);
  });

  it('parses Tj Pura 3-row header: Pihak Ketiga NETT delivery + Pabrik NETT receive', () => {
    const matrix = [
      ['PERIODE : JULI 2026'],
      [],
      [
        'No.',
        'TX',
        'No Ref',
        'Tanggal Laporan',
        'Tanggal Pengiriman',
        'Nomor DO',
        'NO KONTRAK',
        'NO PO',
        'NO STO',
        'Relasi',
        'Pihak Ketiga',
        '',
        '',
        'Pabrik',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Berat Kotor',
        'Tare',
        'NETT',
        'Berat Kotor',
        'Tare',
        'NETT',
      ],
      [
        '',
        '',
        'NO REF',
        'TANGGAL',
        'tgl',
        'NO DO',
        'NO KONTRAK',
        'NO PO',
        'NO STO',
        'Relasi',
        'B. PKS',
        'T. PKS',
        'N. PKS',
        'B. PABRIK',
        'T. PABRIK',
        'N. PABRIK',
      ],
      [
        1,
        'BEL',
        'EUK1',
        46204,
        46203,
        'CO/1',
        'CO/1',
        1001030780,
        1006018999,
        'SUP',
        4930,
        3950,
        980,
        4911,
        3930,
        981,
      ],
      [
        2,
        'BEL',
        'EUK2',
        46204,
        46203,
        'CO/2',
        'CO/2',
        1001030741,
        '',
        'SUP',
        6600,
        0,
        6600,
        6609,
        0,
        6609,
      ],
    ];
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix(
      'TERIMA CPO TRUCK',
      matrix,
      toIsoDate10FromCell,
    );
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]?.poNumber).toBe('1001030780');
    expect(tickets[0]?.stoNumber).toBe('1006018999');
    expect(tickets[0]?.progressDateIso).toBe('2026-07-01');
    expect(tickets[0]?.nettoPksKg).toBe(980);
    expect(tickets[0]?.nettoEupKg).toBe(981);
    expect(tickets[1]?.poNumber).toBe('1001030741');
    expect(tickets[1]?.stoNumber).toBeNull();
    expect(tickets[1]?.nettoPksKg).toBe(6600);
    expect(tickets[1]?.nettoEupKg).toBe(6609);
  });

  it('parses Tj Pura 2-row header (POME style) without emitting subheader as ticket', () => {
    const matrix = [
      ['PERIODE : JULI 2026'],
      [],
      [
        'No.',
        'TX',
        'No Ref',
        'Tanggal Laporan',
        'Tanggal Pengiriman',
        'Nomor DO',
        'Nomor Kontrak',
        'NO PO',
        'NO STO',
        'Pihak Ketiga',
        '',
        '',
        'Pabrik',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Berat Kotor',
        'Tare',
        'NETT',
        'Berat Kotor',
        'Tare',
        'NETT',
      ],
      [
        1,
        'BEL',
        'EUK1541301',
        46204,
        46203,
        '006/POME',
        '006/POME',
        1001030213,
        '',
        25220,
        8570,
        16650,
        25290,
        8660,
        16630,
      ],
    ];
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix(
      'POME',
      matrix,
      toIsoDate10FromCell,
    );
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1001030213');
    expect(tickets[0]?.nettoPksKg).toBe(16650);
    expect(tickets[0]?.nettoEupKg).toBe(16630);
    expect(tickets[0]?.progressDateIso).toBe('2026-07-01');
  });

  it('parses EUP ticket rows with STO and aggregates by PO + date only (multi-STO sums into one row)', () => {
    const matrix = [
      ['No.', 'STO', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
      [1, '1006018596', '1001029784', '01/06/2026', 17200, 17140],
      [2, '1006018597', '1001029784', '01/06/2026', 17350, 17310],
      [3, '1006019000', '1001030126', '02/06/2026', 17120, 17110],
    ];
    const { tickets } = parseWbRekapSheetMatrix('CPO', matrix, parseDate);
    expect(tickets).toHaveLength(3);
    expect(tickets[0]?.stoNumber).toBe('1006018596');
    expect(tickets[0]?.klipProduct).toBe('CPO');
    const aggregated = aggregateWbRekapTickets(tickets);
    // Same PO + same date, different STOs → merged into a single PO-level row.
    expect(aggregated).toHaveLength(2);
    const combined = aggregated.find((a) => a.poNumber === '1001029784');
    const other = aggregated.find((a) => a.poNumber === '1001030126');
    expect(combined?.sumNettoPksKg).toBe(17200 + 17350);
    expect(combined?.sumNettoEupKg).toBe(17140 + 17310);
    expect(combined?.ticketCount).toBe(2);
    expect(combined?.stoNumbers?.sort()).toEqual(['1006018596', '1006018597']);
    expect(other?.sumNettoPksKg).toBe(17120);
    expect(other?.sumNettoEupKg).toBe(17110);
    expect(other?.stoNumbers).toEqual(['1006019000']);
  });

  it('parses EOP Netto EOP as receive qty', () => {
    const matrix = [
      ['No.', 'STO', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EOP'],
      [1, '1386002103', '1381002679', '02/06/2026', 18090, 18110],
    ];
    const { tickets } = parseWbRekapSheetMatrix('RPS', matrix, parseDate);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1381002679');
    expect(tickets[0]?.stoNumber).toBe('1386002103');
    expect(tickets[0]?.nettoPksKg).toBe(18090);
    expect(tickets[0]?.nettoEupKg).toBe(18110);
  });

  it('parses SPC 2-row header: No PO/STO + Timbangan Kebun/SPC Netto', () => {
    const matrix = [
      ['REKAP TIMBANGAN PT.SUMBER PANGAN CEMERLANG 2026'],
      [
        'No.',
        'TANGGAL',
        'No.',
        'BST',
        'No. Tiket',
        'No. DO',
        'No. KONTRAK',
        'Term',
        'No PO/STO',
        'Nama Supplier',
        'No. Polisi',
        'Nama Driver',
        'Tanggal Muat',
        'Timbangan Kebun',
        '',
        '',
        '',
        'Tanggal Bongkar',
        'Jam Datang Di EUP',
        'Timbangan SPC(kg)',
        '',
        '',
        '',
        'Selisih',
        'Persentase',
        'BA',
        'FFA',
        'MOIST',
        'DIRT',
        'DOBI',
        'KOMMODITI',
        'PKS',
        'Tanggal 1',
        'Tanggal 2',
        'Jam keluar',
        'STO',
        'Transportir',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Keluar',
        'Masuk',
        'Netto',
        'TOTAL',
        '',
        '',
        'Masuk',
        'Keluar',
        'Netto',
        'TOTAL',
      ],
      [
        '3207',
        '2026-06-02',
        '1',
        '3001',
        'SCD4005174',
        'DO-1',
        '1002000006042',
        'FRANCO',
        '1641000303',
        'EUPHO',
        'BK 8552 LG',
        'PRAWIRA',
        '31-May-26',
        '39690',
        '11930',
        '27760',
        '27760',
        '2-Jun-26',
        '11:26:51',
        '39980',
        '12200',
        '27780',
        '27780',
        '20',
        '0.07',
        '-',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '1006018596',
        'PNI',
      ],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(1);
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('CPO SPC', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1641000303');
    expect(tickets[0]?.stoNumber).toBe('1006018596');
    expect(tickets[0]?.nettoPksKg).toBe(27760);
    expect(tickets[0]?.nettoEupKg).toBe(27780);
    expect(tickets[0]?.progressDateIso).toBe('2026-06-02');
  });

  it('silently skips TOTAL / T O T A L subtotal footer rows instead of reporting a row-parse failure', () => {
    const matrix = [
      ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
      [1, '1001029784', '01/06/2026', 17200, 17140],
      ['TOTAL', '', '', 17200, 17140],
      [2, '1001029785', '02/06/2026', 8000, 7900],
      ['T O T A L ', '', '', 8000, 7900],
    ];
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('CPO', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.poNumber)).toEqual(['1001029784', '1001029785']);
  });

  it('skips a TOTAL footer row even when the label lands in the STO cell', () => {
    const matrix = [
      ['No.', 'STO', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
      [1, '1006018596', '1001029784', '01/06/2026', 17200, 17140],
      [2, 'TOTAL', '', '', 17200, 17140],
    ];
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('CPO', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
  });

  it('resolves Kumai single-row header: bare PO/STO, Tanggal Penerimaan, NETT (Pihak Ketiga)/NETT (Pabrik)', () => {
    const matrix = [
      [
        'No.',
        'TX',
        'No Ref',
        'Tanggal Penerimaan',
        'STO',
        'PO',
        'Relasi',
        'Nama Supir',
        'Nomor Truck',
        'Berat Kotor (Pihak Ketiga)',
        'Tare (Pihak Ketiga)',
        'NETT (Pihak Ketiga)',
        'Berat Kotor (Pabrik)',
        'Tare (Pabrik)',
        'NETT (Pabrik)',
      ],
      [1, 'BEL', 'EUK1', '01/06/2026', '1006018750', '1001030371', 'SUP', 'DRV', 'TRK', 20000, 4810, 15190, 19980, 4810, 15170],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(0);
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('01 Juli', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1001030371');
    expect(tickets[0]?.stoNumber).toBe('1006018750');
    expect(tickets[0]?.nettoPksKg).toBe(15190);
    expect(tickets[0]?.nettoEupKg).toBe(15170);
  });

  it('resolves Palembang 2-row header: No. PO + Timbangan Kebun/EUP Netto (ignores No. Tiket Timbangan Pabrik decoy)', () => {
    const matrix = [
      [
        'No.',
        'TANGGAL',
        'No.',
        'No. Tiket Timbangan Pabrik',
        'No. DO',
        'No. KONTRAK',
        'No. PO',
        'Term',
        'Tanggal Muat',
        'Timbangan Kebun',
        '',
        '',
        '',
        'Tanggal Bongkar',
        'Timbangan EUP (kg)',
        '',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Masuk',
        'Keluar',
        'Netto',
        'TOTAL',
        '',
        'Masuk',
        'Keluar',
        'Netto',
        'TOTAL',
      ],
      [803, '05/01/2026', 1, 'EU5500', 'DO-1', 'KTR-1', '1001026574', 'LOCO', '05/01/2026', 18000, 5060, 12940, 12940, '05/01/2026', 18020, 5070, 12950, 12950],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(0);
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('CKG (3)', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1001026574');
    expect(tickets[0]?.nettoPksKg).toBe(12940);
    expect(tickets[0]?.nettoEupKg).toBe(12950);
  });

  it('resolves Tj Buton 2-row header: No. PO/No. STO + Timbangan pabrik(delivery)/RSB(receive) Netto (ignores No. Tiket Timbangan RSB decoy)', () => {
    const matrix = [
      [
        'No.',
        'TANGGAL',
        'No. Tiket Timbangan RSB',
        'NO DO',
        'NO KONTRAK',
        'No. PO',
        'No. STO',
        'Term',
        'Tanggal Muat',
        'Timbangan pabrik  (kg)',
        '',
        '',
        '',
        'Moist pabrik',
        'Tanggal Bongkar',
        'Timbangan RSB (kg)',
        '',
        '',
        '',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Bruto',
        'Tarra',
        'Netto',
        'Total',
        '',
        '',
        'Bruto',
        'Tarra',
        'Netto',
        'Total',
      ],
      [1, '02/01/2026', 'RSB1135066', 'DO-1', 'KTR-1', '1361001949', '1366000999', 'LOCO', '01/01/2026', 43.31, 12.42, 30.89, 245.86, 19.96, '02/01/2026', 43.12, 12.39, 30.73, 241.41],
    ];
    expect(findWbRekapHeaderRowIndex(matrix)).toBe(0);
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix('Sheet1', matrix, parseDate);
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.poNumber).toBe('1361001949');
    expect(tickets[0]?.stoNumber).toBe('1366000999');
    expect(tickets[0]?.nettoPksKg).toBe(30.89);
    expect(tickets[0]?.nettoEupKg).toBe(30.73);
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

  it('parses sample WB workbooks from docs when present', () => {
    const candidates = [
      'WB - Rekap INCOMING TIMB-EUP-BTG JUNI 2026.xlsx',
      'Rekap INCOMING TIMB-EUP-BTG JUNI 2026.xlsx',
      'WB - Laporan Tiimbangan Material Trade EOP - TJMorawa ( JUNI 2026) (1).xlsx',
      'WB - Laporan Tiimbangan Material Trade EOP - TJMorawa ( JUNI 2026) (2).xlsx',
      'WB - Tj Pura.xlsx',
      'WB - Bontang.xlsx',
      'WB - Kumai.xlsx',
      'WB - Palembang.xlsx',
      'WB - Tj Buton.xlsx',
    ];
    for (const name of candidates) {
      const samplePath = path.resolve(__dirname, `../../../docs/${name}`);
      if (!fs.existsSync(samplePath)) continue;

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
      expect(result.sheetsProcessed.length + result.sheetsSkipped.length).toBe(wb.SheetNames.length);
      if (name.includes('Rekap INCOMING') || name.includes('EUP-BTG')) {
        expect(result.sheetsProcessed.length).toBeGreaterThan(0);
        expect(result.rawTicketRows).toBeGreaterThan(0);
        expect(result.aggregated.some((a) => a.poNumber === '1001029784')).toBe(true);
      }
      if (name.includes('(1)')) {
        // EOP layout — Netto EOP receive must populate
        const withReceive = result.tickets.filter((t) => t.nettoEupKg > 0);
        expect(withReceive.length).toBeGreaterThan(0);
      }
      if (name.includes('(2)')) {
        // SPC layout must be detected on at least one sheet
        expect(result.sheetsProcessed.length).toBeGreaterThan(0);
        expect(result.rawTicketRows).toBeGreaterThan(0);
      }
      if (name.includes('Tj Pura')) {
        expect(result.sheetsProcessed).toContain('TERIMA CPO TRUCK');
        expect(result.sheetsSkipped.some((s) => s.sheetName === 'COVER')).toBe(true);
        expect(result.sheetsSkipped.some((s) => s.sheetName === 'PIVOT CPO')).toBe(true);
        expect(result.rawTicketRows).toBeGreaterThan(0);
        const cpoTickets = result.tickets.filter((t) => t.sheetName === 'TERIMA CPO TRUCK');
        expect(cpoTickets.length).toBeGreaterThan(0);
        expect(cpoTickets.some((t) => t.nettoPksKg > 0 && t.nettoEupKg > 0)).toBe(true);
        expect(cpoTickets.every((t) => Boolean(t.poNumber))).toBe(true);
      }
      if (name.includes('Bontang')) {
        expect(result.sheetsProcessed.length).toBeGreaterThan(0);
        expect(result.rawTicketRows).toBeGreaterThan(0);
        expect(result.tickets.some((t) => t.nettoPksKg > 0 && t.nettoEupKg > 0)).toBe(true);
        // No stray "TOTAL"-labeled tickets should leak through as data rows.
        expect(result.tickets.every((t) => !/^t\s*o\s*t\s*a\s*l$/i.test(t.poNumber))).toBe(true);
      }
      if (name.includes('Kumai') || name.includes('Palembang') || name.includes('Tj Buton')) {
        expect(result.sheetsProcessed.length).toBeGreaterThan(0);
        expect(result.rawTicketRows).toBeGreaterThan(0);
        const withBoth = result.tickets.filter((t) => t.nettoPksKg > 0 && t.nettoEupKg > 0);
        expect(withBoth.length).toBeGreaterThan(0);
        expect(result.tickets.every((t) => !/^t\s*o\s*t\s*a\s*l$/i.test(t.poNumber))).toBe(true);
      }
    }
  });
});
