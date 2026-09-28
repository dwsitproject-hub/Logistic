import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  findOsClaimSheet,
  findRealClaimSheet,
  parseOsClaimSheet,
  parseRealClaimSheet,
  readPeriodLabel,
} from './claimSusutWorkbook';

/*
 * Synthetic copies of the two layouts in the 31 Aug 2026 export, cut down to the shape that
 * matters: title rows, split headers, the formula-repeated header row, merged banners, vendor
 * names written once, subtotal rows. The real file holds commercial data and is not a fixture.
 */
function osSheet(): XLSX.WorkSheet {
  const aoa: unknown[][] = [
    ['KPN GROUP', null, null, null, null, 0, '0-30'],
    ['REKAP OUTSTANDING CLAIM QUANTITY - ALL REGION', null, null, null, null, 31, '31-60'],
    ['PERIODE : S/D 31 AUGUST 2026', null, null, null, null, 61, '61-90'],
    [null, null, null, null, null, 91, '>91 Days'],
    [],
    ['NO', 'VENDOR CODE', 'VENDOR NAME', 'STA', 'CR NO', 'CR DATE', 'OS', 'AGING', 'DEST', 'NO PO', 'NO KONTRAK', 'COMM', 'COMMODITY', 'MATERIAL DESCRIPTION', 'CURRE', 'GROUP ', 'KETERANGAN', 'COMPA', 'TYPE', 'DIAJUKAN', 'UOM', null, null, null],
    [null, null, null, null, 'CLAIM', 'CLAIM', 'DAYS', null, null, null, null, null, null, null, null, null, null, 'CODE', 'CLAIM', 'QUANTITY', null, 'AMOUNT BEFORE TAX (IDR)', 'TAX', 'AMOUNT AFTER TAX (IDR)'],
    ['NO', 'VENDOR CODE', 'VENDOR NAME', 'STA', 'CR NO', 'CR DATE', 'OS', 'AGING', 'DEST', 'NO PO', 'NO KONTRAK', 'COMM', 'COMMODITY', 'MATERIAL DESCRIPTION', 'CURRE', 'GROUP ', 'KETERANGAN', 'COMPA', 'TYPE', 'QUANTITY', 'UOM', 'AMOUNT BEFORE TAX (IDR)', 'TAX', 'AMOUNT AFTER TAX (IDR)'],
    [1, 'LN1', 'VENDOR A PT.', 'CR', 1005002960, '10.04.2026', 144, '>91 Days', 'BTG', 1001026598, 1172000000489, '8030', 'PK', 'PALM KERNEL (PK)', 'IDR', 'SURVEYOR', 'SURVEYOR // X', 'EU', 'SUSUT', 9836.52, 'KG', 114447910, null, 114447910],
    [1, 'LN1', 'VENDOR A PT.', 'CR', 1005003569, '22.07.2026', 41, '31-60', 'BTG', 1001030088, 'BMA-SH/0002', '8031', 'SHELL PALM', 'SHELL PALM GGL', 'IDR', 'VESSEL VOYAGE', 'VESSEL VOYAGE // BG', 'EU', 'SUSUT', 46650, 'KG', 37320000, null, 37320000],
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

function realSheet(): XLSX.WorkSheet {
  const aoa: unknown[][] = [
    ['KPN GROUP'],
    ['REKAP REALISASI CLAIM QUANTITY - ALL REGION'],
    ['PERIODE :1  S/D 31 AUGUST 2026'],
    [],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, 'STA', 'COMPA', null, null, 'JUMLAH CLAIM DISETUJUI'],
    ['NO', 'VENDOR CODE', 'VENDOR DESCRIPTION', 'CARGO SOURCE', 'NO CR', 'CLAIM DATE', 'CM DATE', 'PO CN DATE', 'NO PO', 'COMM', 'COMMODITY', 'MATERIAL DESCRIPTION', 'DEST', 'CLA', 'CODE', 'TYPE OF', 'CURRE', 'SURAT CLAIM KETERANGAN', null, null, null, null, 'KETERANGAN'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'CLAIM', null, 'QUANTITY', 'UOM', 'AMOUNT BEFORE', 'TAX', 'AMOUNT AFTER'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'TAX (IDR)', '(IDR)', 'TAX (IDR)'],
    [1, 'LN2', 'VENDOR B PT.', 'SOURCE X', 1015000161, '15.07.2026', '20.08.2026', '20.08.2026', 1011002952, '8010', 'CPO', 'CRUDE PALM OIL', 'BKS', 'CM', 'PS', 'SUSUT', 'IDR', 1490, 'KG', 21832970, null, 21832970, 'VESSEL VOYAGE // BG. X'],
    [null, null, null, 'SOURCE Y', 1015000162, '20.07.2026', '20.08.2026', '20.08.2026', 1011002952, '8010', 'CPO', 'CRUDE PALM OIL', 'BKS', 'CM', 'PS', 'SUSUT', 'IDR', 2820, 'KG', 41781120, null, 41781120, 'VESSEL VOYAGE // BG. X'],
    [null, 'SUB TOTAL', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 4310, 'KG', 63614090, null, 63614090],
    [2, 'LN3', 'VENDOR C PT.', 'SOURCE Z', 1005003692, '11.08.2026', '26.08.2026', '26.08.2026', 1006019263, '8030', 'PK', 'PALM KERNEL', null, 'CM', 'EU', 'SUSUT', 'IDR', 100, 'KG', 1215000, null, 1215000, null],
    [null, 'GRANDTOTAL', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 4410, 'KG', 64829090, null, 64829090],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // The two banners over QUANTITY..AMOUNT AFTER, as in the export (R5:V5 and R6:V6).
  ws['!merges'] = [
    { s: { r: 4, c: 17 }, e: { r: 4, c: 21 } },
    { s: { r: 5, c: 17 }, e: { r: 5, c: 21 } },
  ];
  return ws;
}

describe('which sheet', () => {
  it('finds OS_CLAIM by name instead of taking the first sheet', () => {
    // SheetNames[0] in the export is PIVOT - reading it is what broke the upload.
    expect(findOsClaimSheet(['PIVOT', 'OS_CLAIM', 'REAL_CLAIM'])).toBe('OS_CLAIM');
  });
  it('still accepts the previous export, whose sheet was OSClaim_Susut', () => {
    expect(findOsClaimSheet(['OSClaim_Susut'])).toBe('OSClaim_Susut');
  });
  it('finds nothing in a workbook without an outstanding sheet', () => {
    expect(findOsClaimSheet(['PIVOT', 'Sheet1'])).toBeNull();
  });
  it('treats REAL_CLAIM as optional', () => {
    expect(findRealClaimSheet(['PIVOT', 'OS_CLAIM', 'REAL_CLAIM'])).toBe('REAL_CLAIM');
    expect(findRealClaimSheet(['OS_CLAIM'])).toBeNull();
  });
  it('reads the period from the title rows', () => {
    expect(readPeriodLabel([['KPN'], [], ['PERIODE : S/D 31 AUGUST 2026']])).toBe('S/D 31 AUGUST 2026');
  });
});

describe('OS_CLAIM', () => {
  const os = parseOsClaimSheet(osSheet());

  it('needs none of the columns the current export dropped', () => {
    // VENDOR TYPE, CREATED BY and METODE PAYMENT used to be required; this layout has none of them.
    expect(os.missing).toEqual([]);
  });

  it('starts at the first data row, past the formula-repeated header', () => {
    expect(os.rows).toHaveLength(2);
    expect(os.rows[0].sheetRow).toBe(9);
  });

  it('maps the renamed and split headers', () => {
    const r = os.rows[0];
    expect(r.groupOfTransport).toBe('SURVEYOR'); // GROUP, was GROUP OF TRANSPORT
    expect(r.osDays).toBe(144); // OS / DAYS
    expect(r.companyCode).toBe('EU'); // COMPA / CODE
    expect(r.qtyClaim).toBe(9836.52); // QUANTITY, was DIAJUKAN
    expect(r.crDate).toBe('2026-04-10'); // dd.mm.yyyy, not 4 October
    expect(r.materialDescription).toBe('PALM KERNEL (PK)');
    expect(r.amountAfterTax).toBe(114447910);
  });

  it('reports what is missing rather than importing the wrong sheet', () => {
    const pivot = XLSX.utils.aoa_to_sheet([['Sum of AMOUNT AFTER TAX (IDR)'], ['GROUP', '0-30'], ['SURVEYOR', 1]]);
    const res = parseOsClaimSheet(pivot);
    expect(res.rows).toHaveLength(0);
    expect(res.missing).toContain('VENDOR CODE');
  });
});

describe('REAL_CLAIM', () => {
  const real = parseRealClaimSheet(realSheet());

  it('finds QUANTITY under the merged banners', () => {
    expect(real.missing).toEqual([]);
    expect(real.rows.map((r) => r.qtyApproved)).toEqual([1490, 2820, 100]);
  });

  it('skips SUB TOTAL and GRANDTOTAL rows', () => {
    expect(real.rows.map((r) => r.crNo)).toEqual(['1015000161', '1015000162', '1005003692']);
  });

  it('gives a vendor the claims listed under its first row', () => {
    expect(real.rows[1].vendorCode).toBe('LN2');
    expect(real.rows[1].vendorName).toBe('VENDOR B PT.');
    expect(real.rows[2].vendorCode).toBe('LN3');
  });

  it('joins split headers into the column name', () => {
    const r = real.rows[0];
    expect(r.typeOfClaim).toBe('SUSUT'); // TYPE OF / CLAIM
    expect(r.companyCode).toBe('PS'); // COMPA / CODE
    expect(r.statusClaim).toBe('CM'); // STA / CLA
    expect(r.amountBeforeTax).toBe(21832970); // AMOUNT BEFORE / TAX (IDR)
    expect(r.amountAfterTax).toBe(21832970);
    expect(r.cmDate).toBe('2026-08-20');
  });

  it('takes the transport from KETERANGAN, and leaves it empty when there is none', () => {
    expect(real.rows[0].transportGroup).toBe('VESSEL VOYAGE');
    expect(real.rows[2].transportGroup).toBeNull();
  });

  it('reads its own period label', () => {
    expect(real.periodLabel).toBe('1 S/D 31 AUGUST 2026');
  });
});
