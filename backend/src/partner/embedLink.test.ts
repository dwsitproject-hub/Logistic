import { describe, expect, it } from 'vitest';
import { buildKmapsEmbedUrl, kmapsEmbedBase } from './embedLink';

const base = kmapsEmbedBase('https://test-kmaps.kpndomain.com/some/path/')!;

describe('kmapsEmbedBase', () => {
  it('accepts http(s) URLs only', () => {
    expect(kmapsEmbedBase('http://172.28.92.56:3120')?.origin).toBe('http://172.28.92.56:3120');
    expect(kmapsEmbedBase('ftp://x')).toBeNull();
    expect(kmapsEmbedBase('not a url')).toBeNull();
    expect(kmapsEmbedBase('  ')).toBeNull();
    expect(kmapsEmbedBase(undefined)).toBeNull();
  });
});

describe('buildKmapsEmbedUrl', () => {
  it('builds the root-path URL of KLIP-EMBED.md with every identifier, in order', () => {
    expect(buildKmapsEmbedUrl(base, { op: 'shp_9k2f7q1x', sto: '4500012345', shipment: 'SHP-2026-0412', vessel: 'VSL-0537' })).toBe(
      'https://test-kmaps.kpndomain.com/?embed=1&op=shp_9k2f7q1x&sto=4500012345&shipment=SHP-2026-0412&vessel=VSL-0537',
    );
  });

  it('sends only what exists, and encodes values', () => {
    expect(buildKmapsEmbedUrl(base, { sto: '4500012345' })).toBe('https://test-kmaps.kpndomain.com/?embed=1&sto=4500012345');
    expect(buildKmapsEmbedUrl(base, { shipment: ' A B/C ' })).toBe('https://test-kmaps.kpndomain.com/?embed=1&shipment=A%20B%2FC');
  });

  it('drops a value longer than 64 characters instead of cutting it', () => {
    expect(buildKmapsEmbedUrl(base, { op: 'x'.repeat(65), sto: '1' })).toBe('https://test-kmaps.kpndomain.com/?embed=1&sto=1');
  });

  it('is null without a base or without op / sto / shipment (vessel alone is only a fallback)', () => {
    expect(buildKmapsEmbedUrl(null, { op: 'a' })).toBeNull();
    expect(buildKmapsEmbedUrl(base, { vessel: 'VSL-1' })).toBeNull();
    expect(buildKmapsEmbedUrl(base, {})).toBeNull();
  });
});
