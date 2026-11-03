import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  decodeClaimDataEntities,
  parseClaimDataDate,
  parseClaimDataWorkbook,
} from './claimDataWorkbook';

/*
 * Synthetic cut-downs of the OSCLAIM / REALCLAIM exports (Jan - Oct 2026). The real files are
 * commercial data and are not fixtures; what is kept is the structure that bit us: banners over
 * the header, headers split over rows, entities in text, SUB TOTAL / GRAND TOTAL rows, a page with
 * no header of its own, and mixed numeric / text dates.
 */

const wbOf = (sheets: unknown[][][]) => {
  const wb = XLSX.utils.book_new();
  sheets.forEach((rows, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Sheet${i + 1}`));
  return wb;
};

// ---- OS: 3 header rows (banner, main, sub), data from row 4.
const OS_BANNER = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'COMPA', 'MUTU KONTRAK', '', '', '', 'NETTO', '', '', 'MUTU KLAIM', '', '', '', 'YIELD', 'JLH CLAIM', '', 'JLH CLAIM DIAJUKAN', '', ''];
const OS_MAIN = ['NO', 'VENDOR CODE', 'VENDOR NAME', 'GROUP OF VENDOR', 'VENDOR TYPE', 'TRADERS', 'CREATED BY', 'STA', 'CR NO', 'CR DATE', 'OUTSTANDING', 'DEST', 'NO PO', 'NO KONTRAK', 'COMMODITY', 'MATERIAL DESCRIPTION', 'KETERANGAN', 'CODE', 'FFA', 'M&I', 'DNS', 'DOBI', 'KIRIM', 'FFA', 'M&I', 'DNS', 'DOBI', 'TYPE', 'DIAJUKAN', 'UOM', '', 'AMOUNT BEFORE TAX (US$)', 'TAX', 'AMOUNT AFTER TAX (US$)', 'AMOUNT BEFORE TAX (IDR)', 'TAX', 'AMOUNT AFTER TAX (IDR)'];
// Sub header carries the second half of split labels.
const OS_SUB = ['', '', '', '', '', '', '', '', '', '', 'DAYS', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'CLAIM', 'QUANTITY', '', '', '', '', '', '', '', ''];

/** Column positions here are the ones above; the banners are placed to line up with them. */
function osBanner(): unknown[] {
  const b: unknown[] = Array(OS_MAIN.length).fill(null);
  b[18] = 'MUTU KONTRAK';
  b[22] = 'NETTO';
  b[23] = 'MUTU KLAIM';
  b[27] = 'JLH CLAIM';
  return b;
}

const osRow = (o: { code?: string | null; cr: number; date: unknown; type: string; qty: number; amount: number; ket?: string; po?: number }) => {
  const r: unknown[] = Array(OS_MAIN.length).fill(null);
  r[0] = 1;
  r[1] = o.code === undefined ? 'AT1' : o.code;
  r[2] = o.code === null ? null : 'VENDOR &#x28;A&#x29; PT.';
  r[4] = '3rd PARTY';
  r[8] = o.cr;
  r[9] = o.date;
  r[10] = 12;
  r[11] = 'KJG';
  r[12] = o.po ?? 1006020021;
  r[14] = 'CPKO';
  r[16] = o.ket ?? null;
  r[18] = 0;
  r[19] = 0;
  r[20] = 0;
  r[21] = 2;
  r[23] = 1;
  r[27] = o.type;
  r[28] = o.qty;
  r[29] = 'KG';
  r[34] = o.amount;
  r[36] = o.amount;
  return r;
};

describe('claim data dates and entities', () => {
  it('decodes SAP entities', () => {
    expect(decodeClaimDataEntities('A&#x2f;B &#x28;C&#x29; &amp; D')).toBe('A/B (C) & D');
  });

  it('reads text dates as written and swaps numeric serials back', () => {
    expect(parseClaimDataDate('13.10.2026')).toBe('2026-10-13');
    expect(parseClaimDataDate('00.00.0000')).toBeNull();
    // Excel serial 46183 is 2026-06-10; the export swapped day and month, so the real date is 6 Oct.
    expect(parseClaimDataDate(46183.00013888889)).toBe('2026-10-06');
    // A serial whose day is above 12 cannot have been swapped.
    expect(parseClaimDataDate(46187)).toBe('2026-06-14');
  });
});

describe('parseClaimDataWorkbook (OS)', () => {
  const sheet1 = [
    osBanner(),
    OS_MAIN,
    OS_SUB,
    osRow({ cr: 1005004059, date: 46183.0001, type: 'SUSUT', qty: 1000, amount: 5_000_000, ket: 'VESSEL TC &#x2f;&#x2f; TB. X' }),
    ['', 'SUB TOTAL', ...Array(OS_MAIN.length - 2).fill(null)],
    osRow({ code: null, cr: 1005004060, date: '20.07.2026', type: 'MUTU', qty: 500, amount: 2_000_000 }),
  ];
  // A continuation page: no header block at all.
  const sheet2 = [
    osRow({ cr: 1005004061, date: '13.10.2026', type: 'MUTU', qty: 250, amount: 1_000_000, code: 'AT2' }),
    ['', 'GRAND TOTAL', ...Array(OS_MAIN.length - 2).fill(null)].map((v, i) => (i === 27 ? 1750 : i === 34 ? 8_000_000 : v)),
  ];
  // OS_MAIN positions: qty 28, uom 29, amount IDR at 34/35/36 (before, tax, after).
  sheet2[1][28] = 1750;
  sheet2[1][34] = 8_000_000;
  sheet2[1][36] = 8_000_000;
  sheet2[1][27] = null;

  const result = parseClaimDataWorkbook(wbOf([sheet1, sheet2]), 'os');

  it('reads every claim, including the page without a header, and skips totals', () => {
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.crNo)).toEqual(['1005004059', '1005004060', '1005004061']);
    expect(result.subtotalRowsSkipped).toBe(1);
    expect(result.sheetsRead).toBe(2);
  });

  it('splits MUTU and SUSUT by TYPE CLAIM and decodes text', () => {
    expect(result.rows.map((r) => r.claimType)).toEqual(['SUSUT', 'MUTU', 'MUTU']);
    expect(result.rows[0].keterangan).toBe('VESSEL TC // TB. X');
    expect(result.rows[0].transportGroup).toBe('VESSEL TC');
    expect(result.rows[0].mutuKontrak.dobi).toBe(2);
  });

  it('carries the vendor down and swaps numeric dates', () => {
    expect(result.rows[1].vendorCode).toBe('AT1');
    expect(result.rows[1].vendorName).toBe('VENDOR (A) PT.');
    expect(result.rows[0].crDate).toBe('2026-10-06');
    expect(result.rows[1].crDate).toBe('2026-07-20');
  });

  it('takes quantity and IDR amounts, and matches the file GRAND TOTAL', () => {
    expect(result.rows[0].qty).toBe(1000);
    expect(result.rows[0].amountAfterTax).toBe(5_000_000);
    expect(result.rowTotals).toEqual({ qty: 1750, amountAfterTax: 8_000_000 });
    expect(result.reportedTotals).toEqual({ qty: 1750, amountAfterTax: 8_000_000 });
    expect(result.warnings).toEqual([]);
  });
});

describe('parseClaimDataWorkbook (errors)', () => {
  it('reports a workbook with no claim sheet', () => {
    const r = parseClaimDataWorkbook(wbOf([[['hello']]]), 'os');
    expect(r.rows).toEqual([]);
    expect(r.errors.length).toBe(1);
  });
});
