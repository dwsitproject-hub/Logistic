import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildTandaTerimaPdf,
  buildTandaTerimaSuppliersLabel,
  formatTandaTerimaSendDate,
  groupTandaTerimaLinesBySupplier,
  tandaTerimaDownloadFilename,
  tandaTerimaRowsThatFit,
} from '../services/tandaTerimaPdf.service';

describe('tandaTerimaPdf.service', () => {
  it('formatTandaTerimaSendDate uses en-GB short month', () => {
    expect(formatTandaTerimaSendDate('2026-06-10')).toBe('10 Jun 2026');
  });

  it('buildTandaTerimaSuppliersLabel dedupes and joins with comma', () => {
    expect(
      buildTandaTerimaSuppliersLabel([
        { contractExtNo: 'A', supplier: 'Supplier One' },
        { contractExtNo: 'B', supplier: 'Supplier Two' },
        { contractExtNo: 'C', supplier: 'Supplier One' },
      ]),
    ).toBe('Supplier One, Supplier Two');
  });

  it('buildTandaTerimaSuppliersLabel returns dash when empty', () => {
    expect(buildTandaTerimaSuppliersLabel([{ contractExtNo: 'A', supplier: null }])).toBe('-');
  });

  it('tandaTerimaDownloadFilename includes send date', () => {
    expect(tandaTerimaDownloadFilename('2026-06-10')).toBe('Tanda_Terima_2026-06-10.pdf');
  });

  it('buildTandaTerimaPdf returns non-empty PDF bytes', async () => {
    const bytes = await buildTandaTerimaPdf({
      lines: [
        { contractExtNo: '002.CPO/PT-SUEK/KONTRAK/0126', supplier: 'SRI ULINA ERSADA KARINA PT' },
        { contractExtNo: '003.CPO/PT-SUEK/KONTRAK/0126', supplier: 'SRI ULINA ERSADA KARINA PT' },
      ],
      sendDateIso: '2026-06-10',
      senderEmail: 'dewi.siswanti@energi-up.com',
      senderFullName: 'Dewi Siswanti',
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('groupTandaTerimaLinesBySupplier keeps first-seen order and merges same supplier', () => {
    const groups = groupTandaTerimaLinesBySupplier([
      { contractExtNo: 'CTR-1', supplier: 'Supplier A' },
      { contractExtNo: 'CTR-2', supplier: 'Supplier A' },
      { contractExtNo: 'CTR-3', supplier: 'Supplier B' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.supplierLabel).toBe('Supplier A');
    expect(groups[0]?.lines).toHaveLength(2);
    expect(groups[1]?.supplierLabel).toBe('Supplier B');
    expect(groups[1]?.lines).toHaveLength(1);
  });

  it('buildTandaTerimaPdf splits one page per supplier', async () => {
    const bytes = await buildTandaTerimaPdf({
      lines: [
        { contractExtNo: 'CTR-1', supplier: 'Supplier A' },
        { contractExtNo: 'CTR-2', supplier: 'Supplier A' },
        { contractExtNo: 'CTR-3', supplier: 'Supplier B' },
      ],
      sendDateIso: '2026-06-10',
      senderEmail: 'ops@example.com',
      senderFullName: 'Ops User',
    });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
  });
});

describe('buildTandaTerimaPdf with many POs of one supplier', () => {
  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ contractExtNo: `18100008${String(i).padStart(2, '0')}`, supplier: 'BIMA PALMA NUGRAHA PT.' }));
  const build = async (n: number) => {
    const bytes = await buildTandaTerimaPdf({ lines: lines(n), sendDateIso: '2026-11-17', senderEmail: 'a@b.c', senderFullName: 'A B' });
    return (await PDFDocument.load(bytes)).getPageCount();
  };

  it('a short list is still one page', async () => {
    expect(await build(1)).toBe(1);
    expect(await build(10)).toBe(1);
  });
  it('50 POs no longer run off the bottom of one page: the table continues on a second page, which also carries the signatures', async () => {
    expect(await build(50)).toBe(2);
  });
  it('when the table fills a page exactly, the closing block gets a page of its own rather than falling off the bottom', async () => {
    const fit = tandaTerimaRowsThatFit(701.89); // first page, one-line supplier name
    expect(await build(fit)).toBe(2);
  });
  it('a very long list keeps going, page after page', async () => {
    expect(await build(120)).toBeGreaterThanOrEqual(4);
  });
});
