import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  findClaimMutuSheets,
  markB2bByExclusion,
  normalizeClaimMutuCommodity,
  osMatchKey,
  parseClaimMutuOsSheet,
  parseClaimMutuRealSheet,
  periodMonthFromLabel,
  unitForDest,
  unmatchedExcludeCount,
} from './claimMutuWorkbook';

/*
 * Synthetic copies of the 31 Aug 2026 layouts, cut to what matters: the aging lookup in the title
 * rows, headers split over two rows, the mutu groups labelled on their first column only, the
 * Include sheet's SUB TOTAL rows, the Real sheet's merged banners. The real workbook is commercial
 * data and is not a fixture.
 */
const OS_H1 = ['NO', 'VENDOR CODE', 'VENDOR NAME', 'GROUP OF VENDOR', 'VENDOR TYPE', 'CARGO SOURCE', 'KETERANGAN', 'METODE PAYMENT', 'GROUP ', 'TYPE OF COMP', 'TRADERS', 'CREATED BY', 'STA', 'CR NO', 'CR DATE', 'OS', 'AGING', 'DEST', 'NO PO', 'NO KONTRAK', 'COMM', 'COMMODITY', 'MATERIAL DESCRIPTION', 'CODE', 'MUTU KONTRAK', null, null, null, 'MUTU KLAIM', null, null, null, 'TYPE', 'DIAJUKAN', 'UOM', 'JMLH YANG DIAJUKAN', null, null];
const OS_H2 = [null, null, null, null, null, null, null, null, null, null, null, null, null, 'CLAIM', 'CLAIM', 'DAYS', null, null, null, null, null, null, null, null, 'FFA', 'M&I', 'DNS', 'DOBI', 'FFA', 'M&I', 'DNS', 'DOBI', 'CLAIM', 'QUANTITY', null, 'AMOUNT BEFORE TAX (IDR)', 'TAX', 'AMOUNT AFTER TAX (IDR)'];
const osRow = (cr: number, po: number, amount: number, extra: Partial<Record<number, unknown>> = {}) => {
  const r: unknown[] = [1, 'AT1', 'VENDOR A PT.', 'SSA', '3rd PARTY', 'SRC', 'POTONG INV', 'POTONG INVOICE', '3RD PARTY (SUPPLIER)', 'DWS - 3RD PARTY', 'Rafi', 'Rinaldi', 'CR', cr, '20.07.2026', 43, '31-60', 'LGU', po, 'K/1', '8031', 'SHELL PALM', 'SHELL PALM GGL', 'EU', 0, 20, 1, 0, 0, 22.25, 0.86, 0, 'MUTU', 13881.21, 'KG', amount, null, amount];
  for (const [k, v] of Object.entries(extra)) r[Number(k)] = v;
  return r;
};
const title = (period: string) => [
  ['KPN GROUP', ...Array(13).fill(null), 0, '0-30'],
  ['REKAP OUTSTANDING CLAIM', ...Array(13).fill(null), 31, '31-60'],
  [`PERIODE :  ${period}`, ...Array(13).fill(null), 61, '61-90'],
  [...Array(14).fill(null), 91, '> 91 Days'],
  [],
];

function osIncSheet(): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ...title('S/D 31 AUGUST 2026'),
    OS_H1,
    OS_H2,
    osRow(1005003548, 1001030277, 14644675),
    [null, 'SUB TOTAL', ...Array(31).fill(null), 13881.21, 'KG', 14644675, null, 14644675],
    osRow(1005003549, 1001027387, 500000, { 8: 'INTERCO (3RD PARTY)', 9: 'DWS - UPS', 21: 'WASTE OIL (POME', 17: 'BTG' }),
    osRow(1005003549, 1001027387, 500000, { 8: 'INTERCO (3RD PARTY)', 9: 'DWS - UPS', 21: 'WASTE OIL (POME', 17: 'BTG' }),
  ]);
}
function osExcSheet(): XLSX.WorkSheet {
  // The Exclude sheet repeats the header through formulas on a third row, and keeps ONE of the pair.
  return XLSX.utils.aoa_to_sheet([
    ...title('S/D 31 AUGUST 2026'),
    OS_H1,
    OS_H2,
    OS_H1,
    osRow(1005003548, 1001030277, 14644675),
    osRow(1005003549, 1001027387, 500000, { 8: 'INTERCO (3RD PARTY)', 9: 'DWS - UPS', 21: 'WASTE OIL (POME', 17: 'BTG' }),
  ]);
}

describe('which sheets', () => {
  it('finds all four data sheets by name, trailing space and all', () => {
    const s = findClaimMutuSheets(['Summary Per Komoditi', 'Pivot (Exc B2B)', 'OS_Claim_Exc_B2B', 'Real_Claim_Exc_B2B ', 'OS_Claim_Inc_B2B', 'Real_Claim_Inc_B2B']);
    expect(s).toMatchObject({ osInc: 'OS_Claim_Inc_B2B', osExc: 'OS_Claim_Exc_B2B', realInc: 'Real_Claim_Inc_B2B', realExc: 'Real_Claim_Exc_B2B ' });
  });
  it('never takes a summary sheet as data', () => {
    const s = findClaimMutuSheets(['Summary Per Komoditi', 'Pivot (Exc B2B)']);
    expect([s.osInc, s.osExc, s.osLegacy]).toEqual([null, null, null]);
  });
});

describe('reference rules', () => {
  it('maps DEST codes to the units the summaries use, KRG and KRW both KARAWANG', () => {
    expect(unitForDest('BTG')).toBe('BONTANG');
    expect(unitForDest('KJG')).toBe('TANJUNG PURA');
    expect(unitForDest('KRG')).toBe('KARAWANG');
    expect(unitForDest('KRW')).toBe('KARAWANG');
    expect(unitForDest('XYZ')).toBe('XYZ'); // unknown: shown as itself, not guessed
  });
  it('restores the bracket SAP cuts off, and files a blank shell commodity under SHELL PALM', () => {
    expect(normalizeClaimMutuCommodity('WASTE OIL (POME', null)).toBe('WASTE OIL (POME)');
    expect(normalizeClaimMutuCommodity(null, 'SHELL PALM GGL')).toBe('SHELL PALM');
    expect(normalizeClaimMutuCommodity(null, 'CRUDE PALM OIL')).toBeNull();
  });
  it('reads the month a file describes from its PERIODE label', () => {
    expect(periodMonthFromLabel('S/D 31 AUGUST 2026')).toBe('2026-08-01');
    expect(periodMonthFromLabel('1 S/D 31 AUGUST 2026')).toBe('2026-08-01');
    expect(periodMonthFromLabel('AGUSTUS 2026')).toBe('2026-08-01');
    expect(periodMonthFromLabel('no date')).toBeNull();
  });
});

describe('OS sheet', () => {
  const inc = parseClaimMutuOsSheet(osIncSheet());
  const exc = parseClaimMutuOsSheet(osExcSheet());

  it('reads data rows only - no SUB TOTAL, no repeated header', () => {
    expect(inc.missing).toEqual([]);
    expect(inc.rows).toHaveLength(3);
    expect(exc.rows).toHaveLength(2);
    expect(exc.rows[0].sheetRow).toBe(9);
  });

  it('keeps mutu kontrak and mutu klaim apart, though both groups have an M&I', () => {
    expect(inc.rows[0].mutuKontrak).toEqual({ ffa: 0, mi: 20, dns: 1, dobi: 0 });
    expect(inc.rows[0].mutuKlaim).toEqual({ ffa: 0, mi: 22.25, dns: 0.86, dobi: 0 });
  });

  it('maps the split and renamed headers', () => {
    const r = inc.rows[0];
    expect(r.claimGroup).toBe('3RD PARTY (SUPPLIER)');
    expect(r.osDays).toBe(43);
    expect(r.crDate).toBe('2026-07-20');
    expect(r.unit).toBe('LUBUK GAUNG');
    expect(r.claimType).toBe('MUTU');
    expect(r.qtyKg).toBe(13881.21);
    expect(r.amountAfterTax).toBe(14644675);
    expect(inc.rows[1].commodity).toBe('WASTE OIL (POME)');
  });
});

describe('B2B', () => {
  const inc = parseClaimMutuOsSheet(osIncSheet()).rows;
  const exc = parseClaimMutuOsSheet(osExcSheet()).rows;

  it('marks exactly the Include rows the Exclude sheet does not hold', () => {
    const marked = markB2bByExclusion(inc, exc, osMatchKey);
    expect(marked.map((r) => r.isB2b)).toEqual([false, false, true]);
  });

  it('counts a claim listed twice in Include and once in Exclude as one B2B row, not two', () => {
    // The August file has such pairs (PO 1001027387). A set match would mark both or neither.
    const marked = markB2bByExclusion(inc, exc, osMatchKey);
    expect(marked.filter((r) => r.poNumber === '1001027387' && r.isB2b)).toHaveLength(1);
  });

  it('reports Exclude rows the Include sheet lacks, a file whose sheets disagree', () => {
    expect(unmatchedExcludeCount(inc, exc, osMatchKey)).toBe(0);
    expect(unmatchedExcludeCount(inc.slice(0, 1), exc, osMatchKey)).toBe(1);
  });
});

describe('Real sheet', () => {
  function realSheet(): XLSX.WorkSheet {
    const ws = XLSX.utils.aoa_to_sheet([
      ['KPN GROUP'],
      ['REKAP REALISASI CLAIM'],
      ['PERIODE :  1 S/D 31 AUGUST 2026'],
      [],
      [...Array(18).fill(null), 'STA', 'COMPA', 'MUTU KONTRAK', null, null, null, 'MUTU CLAIM', null, null, null, null, 'JUMLAH CLAIM DISETUJUI'],
      ['NO', 'VENDOR CODE', 'VENDOR DESCRIPTION', 'GROUP KEY', 'VENDOR TYPE', 'CARGO SOURCE', 'TRADERS', 'KEBUN', 'NO CR', 'CLAIM DATE', 'CM NO', 'CM DATE', 'NO PO', 'NO KONTRAK', 'COMM', 'COMMODITY', 'MATERIAL DESCRIPTION', 'DEST', 'CLA', 'CODE', 'TYPE OF CURRE SURAT CL', null, null, null, 'TYPE OF CURRE SURAT CL', null, null, null, 'TYPE OF', 'SURAT CLAIM'],
      [...Array(20).fill(null), 'FFA/KOT', 'M&I', 'DNS', 'Dobi', 'FFA/KOT', 'M&I', 'DNS', 'DOBI', 'CLAIM', 'QUANTITY', 'UOM', 'AMOUNT BEFORE', 'TAX', 'AMOUNT AFTER'],
      [...Array(31).fill(null), 'TAX (IDR)', '(IDR)', 'TAX (IDR)'],
      [1, 'AT1', 'RANA PT.', 'AGRINA', '3rd PARTY', 'RANA PT.', 'Silvia', 'PLANT', 1005003633, '29.07.2026', 1000001225, '26.08.2026', 1001031059, 1004031059, '8030', 'PK', 'PALM KERNEL (PK)', 'KJG', 'CM', 'EU', 5, 8, 8, 0, 5.49, 6.77, 7.46, 0, 'MUTU', 43.22, 'KG', 592087, null, 592087],
      [null, 'SUB TOTAL', ...Array(27).fill(null), 43.22, 'KG', 592087, null, 592087],
      [null, null, null, null, null, 'OTHER SRC', 'Silvia', 'PLANT', 1005003634, '30.07.2026', 1000001226, '27.08.2026', 1001031060, 1004031060, '8031', null, 'SHELL PALM GGL', 'TJM', 'CM', 'EU', 0, 20, 1, 0, 0, 21, 0.9, 0, 'MUTU', 10, 'KG', 1000, null, 1000],
    ]);
    ws['!merges'] = [
      { s: { r: 4, c: 20 }, e: { r: 4, c: 23 } },
      { s: { r: 4, c: 24 }, e: { r: 4, c: 27 } },
      { s: { r: 4, c: 29 }, e: { r: 4, c: 33 } },
    ];
    return ws;
  }
  const real = parseClaimMutuRealSheet(realSheet());

  it('reads claim rows, skipping SUB TOTAL', () => {
    expect(real.missing).toEqual([]);
    expect(real.rows.map((r) => r.crNo)).toEqual(['1005003633', '1005003634']);
  });

  it('keeps both mutu groups apart, their labels sitting in the banner row', () => {
    expect(real.rows[0].mutuKontrak).toEqual({ ffa: 5, mi: 8, dns: 8, dobi: 0 });
    expect(real.rows[0].mutuKlaim).toEqual({ ffa: 5.49, mi: 6.77, dns: 7.46, dobi: 0 });
  });

  it('reads the approved quantity and amounts under the banners', () => {
    const r = real.rows[0];
    expect(r.qtyKg).toBe(43.22);
    expect(r.amountBeforeTax).toBe(592087);
    expect(r.amountAfterTax).toBe(592087);
    expect(r.cmDate).toBe('2026-08-26');
    expect(r.unit).toBe('TANJUNG PURA');
  });

  it('gives a vendor the claims under its first row, and a blank shell commodity SHELL PALM', () => {
    expect(real.rows[1].vendorCode).toBe('AT1');
    expect(real.rows[1].groupKey).toBe('AGRINA');
    expect(real.rows[1].commodity).toBe('SHELL PALM');
  });
});
