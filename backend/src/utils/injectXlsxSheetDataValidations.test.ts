import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import * as CFB from 'cfb';
import { injectXlsxSheetDataValidations } from './injectXlsxSheetDataValidations';

function sheet1Xml(buf: Buffer): string {
  const cfb = CFB.read(buf, { type: 'buffer' });
  const path =
    cfb.FullPaths.find((p) => p.replace(/\\/g, '/').includes('xl/worksheets/sheet1.xml')) ?? '';
  const entry = CFB.find(cfb, path);
  const content = entry?.content;
  if (content == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) return content.toString('utf8');
  if (content instanceof Uint8Array) return Buffer.from(content).toString('utf8');
  return String(content);
}

describe('injectXlsxSheetDataValidations', () => {
  it('patches sheet1.xml with list dataValidations Excel can show as dropdowns', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Select', 'Vessel'],
      ['', ''],
      ['', ''],
    ]);
    ws['!autofilter'] = { ref: 'A1:B3' };
    XLSX.utils.book_append_sheet(wb, ws, 'Grouping');
    const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

    const patched = injectXlsxSheetDataValidations(raw, 'xl/worksheets/sheet1.xml', [
      { sqref: 'A2:A200', formula: '"Y"', error: 'Isi Y atau biarkan kosong' },
      { sqref: 'B2:B200', formula: 'VesselList', error: 'Pilih Vessel dari sheet Master Vessel' },
    ]);

    const xml = sheet1Xml(patched);
    expect(xml).toContain('<dataValidations count="2">');
    expect(xml).toContain('type="list"');
    expect(xml).toContain('sqref="A2:A200"');
    expect(xml).toContain('sqref="B2:B200"');
    expect(xml).toContain('VesselList');
    expect(xml.indexOf('<dataValidations')).toBeLessThan(xml.indexOf('</worksheet>'));
    if (xml.includes('<ignoredErrors')) {
      expect(xml.indexOf('<dataValidations')).toBeLessThan(xml.indexOf('<ignoredErrors'));
    }
    expect(XLSX.read(patched, { type: 'buffer' }).SheetNames).toEqual(['Grouping']);
  });
});
