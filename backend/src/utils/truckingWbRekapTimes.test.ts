import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  aggregateWbRekapTickets,
  isWbTimeInHeader,
  isWbTimeOutHeader,
  parseWbClockTimeSeconds,
  parseWbRekapSheetMatrix,
  parseWbRekapWorkbook,
  wbClockSecondsToSqlTime,
} from './truckingWbRekapUpload';
import { toIsoDate10FromCell } from './planningSheetDate';

const parseDate = (raw: unknown): string | null => {
  const s = String(raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const hms = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

describe('parseWbClockTimeSeconds', () => {
  it('reads an Excel time the way the workbook reader hands it over, in any time zone', () => {
    // SheetJS builds a time-only cell as a LOCAL Date on 1899-12-30. Under a non-UTC zone the 1899
    // offset (Asia/Jakarta +7:07:12) differs from today's, which broke getHours()-style readers.
    expect(parseWbClockTimeSeconds(new Date(1899, 11, 30, 13, 23, 43))).toBe(hms(13, 23, 43));
    expect(parseWbClockTimeSeconds(new Date(1899, 11, 30, 0, 0, 1))).toBe(1);
    expect(parseWbClockTimeSeconds(new Date(1899, 11, 30, 23, 59, 59))).toBe(hms(23, 59, 59));
  });

  it('reads the time of a full date-time cell and an Excel serial fraction', () => {
    expect(parseWbClockTimeSeconds(new Date(2026, 5, 2, 9, 5, 0))).toBe(hms(9, 5));
    expect(parseWbClockTimeSeconds(46000 + hms(13, 23, 43) / 86400)).toBe(hms(13, 23, 43));
    expect(parseWbClockTimeSeconds(0.5)).toBe(hms(12));
  });

  it('reads typed text with a colon or a dot', () => {
    expect(parseWbClockTimeSeconds('11:26:51')).toBe(hms(11, 26, 51));
    expect(parseWbClockTimeSeconds('9.05')).toBe(hms(9, 5));
    expect(parseWbClockTimeSeconds(' 17:00 ')).toBe(hms(17));
    expect(parseWbClockTimeSeconds('13.23.43')).toBe(hms(13, 23, 43));
  });

  it('treats blanks, zero and non-times as not filled', () => {
    for (const v of ['', '  ', null, undefined, 0, '0', 'abc', '25:00', '12:61', '-', new Date(NaN)]) {
      expect(parseWbClockTimeSeconds(v)).toBeNull();
    }
    // 00:00:00 is what an empty formatted cell reads as
    expect(parseWbClockTimeSeconds(new Date(1899, 11, 30, 0, 0, 0))).toBeNull();
  });

  it('formats seconds as a Postgres TIME', () => {
    expect(wbClockSecondsToSqlTime(hms(9, 5, 7))).toBe('09:05:07');
    expect(wbClockSecondsToSqlTime(hms(23, 59, 59))).toBe('23:59:59');
  });
});

describe('WB time column headers', () => {
  it('matches each site naming, and not the vendor dispatch time', () => {
    for (const h of ['jam masuk', 'jam datang di eup', 'jam datang di rsb', 'jam 1st']) {
      expect(isWbTimeInHeader(h)).toBe(true);
    }
    for (const h of ['jam keluar', 'jam keluar dari eup', 'jam keluar dari rsb', 'jam 2nd']) {
      expect(isWbTimeOutHeader(h)).toBe(true);
    }
    for (const h of ['jam pengiriman', 'waktu pengiriman vendor', 'selisih jam', 'tanggal masuk', 'jam']) {
      expect(isWbTimeInHeader(h)).toBe(false);
      expect(isWbTimeOutHeader(h)).toBe(false);
    }
  });
});

describe('parseWbRekapSheetMatrix times', () => {
  it('reads Jam Masuk / Jam Keluar and skips Jam Pengiriman (Bontang layout)', () => {
    const { tickets, rowParseFailures } = parseWbRekapSheetMatrix(
      'CPO',
      [
        ['No.', 'PO/SO', 'Jam Pengiriman', 'Tanggal Masuk', 'Jam Masuk', 'Jam Keluar', 'Netto PKS', 'Netto EUP'],
        [1, '1001029784', '06:00', '2026-06-01', '09:00', '17:00', 17200, 17140],
      ],
      parseDate,
    );
    expect(rowParseFailures).toEqual([]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].timeInSec).toBe(hms(9));
    expect(tickets[0].timeOutSec).toBe(hms(17));
  });

  it('reads Jam 1st / Jam 2nd from a sub-header row (Kumai / Tj Pura layout)', () => {
    const { tickets } = parseWbRekapSheetMatrix(
      'TERIMA CPO TRUCK',
      [
        ['No.', 'NO PO', 'Tanggal Laporan', 'Jam Pengiriman', 'Weighing In & Out', '', 'Netto PKS', 'Netto EUP'],
        ['', '', '', '', 'Jam 1st', 'Jam 2nd', '', ''],
        [1, '1001030780', '2026-07-01', '10:38', '03:08:33', '09:18:43', 25000, 24900],
      ],
      parseDate,
    );
    expect(tickets).toHaveLength(1);
    expect(tickets[0].timeInSec).toBe(hms(3, 8, 33));
    expect(tickets[0].timeOutSec).toBe(hms(9, 18, 43));
  });

  it('leaves the times off a ticket when the layout has no time columns', () => {
    const { tickets } = parseWbRekapSheetMatrix(
      'CPO',
      [
        ['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
        [1, '1001029784', '2026-06-01', 17200, 17140],
      ],
      parseDate,
    );
    expect(tickets).toHaveLength(1);
    expect('timeInSec' in tickets[0]).toBe(false);
    expect('timeOutSec' in tickets[0]).toBe(false);
  });
});

describe('aggregateWbRekapTickets times', () => {
  const base = { sheetName: 'CPO', klipProduct: null, poNumber: '1001', stoNumber: null, progressDateIso: '2026-06-01' };

  it('keeps the earliest entry and the latest exit of the day', () => {
    const [row] = aggregateWbRekapTickets([
      { ...base, rowNumber: 2, nettoPksKg: 1, nettoEupKg: 1, timeInSec: hms(10, 30), timeOutSec: hms(12) },
      { ...base, rowNumber: 3, nettoPksKg: 1, nettoEupKg: 1, timeInSec: hms(9), timeOutSec: hms(11) },
      { ...base, rowNumber: 4, nettoPksKg: 1, nettoEupKg: 1, timeInSec: hms(14), timeOutSec: hms(17) },
    ]);
    expect(row.firstTimeInSec).toBe(hms(9));
    expect(row.lastTimeOutSec).toBe(hms(17));
  });

  it('ignores tickets without a time and omits the fields when none has one', () => {
    const [withSome] = aggregateWbRekapTickets([
      { ...base, rowNumber: 2, nettoPksKg: 1, nettoEupKg: 1 },
      { ...base, rowNumber: 3, nettoPksKg: 1, nettoEupKg: 1, timeInSec: hms(9) },
    ]);
    expect(withSome.firstTimeInSec).toBe(hms(9));
    expect('lastTimeOutSec' in withSome).toBe(false);

    const [none] = aggregateWbRekapTickets([{ ...base, rowNumber: 2, nettoPksKg: 1, nettoEupKg: 1 }]);
    expect('firstTimeInSec' in none).toBe(false);
    expect('lastTimeOutSec' in none).toBe(false);
  });
});

describe('sample WB workbooks: times', () => {
  const parseSample = (name: string) => {
    const samplePath = path.resolve(__dirname, `../../../docs/${name}`);
    if (!fs.existsSync(samplePath)) return null;
    const wb = XLSX.read(fs.readFileSync(samplePath), { type: 'buffer', cellDates: true });
    const sheets = wb.SheetNames.map((sheetName) => ({
      sheetName,
      matrix: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: true,
      }) as unknown[][],
    }));
    return parseWbRekapWorkbook(sheets, toIsoDate10FromCell);
  };

  // every site names its time columns differently; each must come through for most tickets
  for (const name of [
    'WB - Bontang.xlsx',
    'WB - Kumai.xlsx',
    'WB - Tj Pura.xlsx',
    'WB - Palembang.xlsx',
    'WB - Tj Buton.xlsx',
    'WB - Lubuk Gaung.xlsx',
    'WB - Tj Morawa.xlsx',
  ]) {
    it(`${name}: tickets carry an entry and exit time`, () => {
      const result = parseSample(name);
      if (!result) return;
      const withBoth = result.tickets.filter((t) => t.timeInSec != null && t.timeOutSec != null);
      expect(result.tickets.length).toBeGreaterThan(0);
      expect(withBoth.length / result.tickets.length).toBeGreaterThan(0.5);
      for (const t of withBoth) {
        expect(t.timeInSec).toBeGreaterThan(0);
        expect(t.timeInSec).toBeLessThan(86400);
        expect(t.timeOutSec).toBeGreaterThan(0);
        expect(t.timeOutSec).toBeLessThan(86400);
      }
    });
  }

  it('Palembang: the first ticket reads 13:23:43 in and 15:05:16 out', () => {
    const result = parseSample('WB - Palembang.xlsx');
    if (!result) return;
    const first = result.tickets.find((t) => t.sheetName === 'CKG (3)');
    expect(first?.timeInSec).toBe(hms(13, 23, 43));
    expect(first?.timeOutSec).toBe(hms(15, 5, 16));
  });
});
