import { describe, expect, it } from 'vitest';
import {
  buildTandaTerimaPdf,
  buildTandaTerimaSuppliersLabel,
  formatTandaTerimaSendDate,
  tandaTerimaDownloadFilename,
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
  });
});
