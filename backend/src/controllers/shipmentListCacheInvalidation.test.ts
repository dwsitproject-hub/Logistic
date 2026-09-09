import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every handler that writes to `shipments` must clear the list caches.
 *
 * The Shipments list, Section 1 summary, Outstanding Qty strip and the hybrid breakdowns are all
 * cached in-process for CACHE_TTL_MS. A write that skips invalidateShipmentsListCache() leaves the
 * page showing pre-edit rows until the TTL expires - which is how
 * updateShipmentDailyDeliverables and bulkUploadShipmentDailyDeliverables behaved: both run
 * `UPDATE shipments`, neither invalidated.
 *
 * This is a source-level audit on purpose. The alternative - exercising every endpoint against a
 * database - would not catch a *new* endpoint added without invalidation, which is the failure
 * this test exists to prevent.
 */
describe('shipments write paths invalidate the list caches', () => {
  const src = readFileSync(join(__dirname, 'shipment.controller.ts'), 'utf8');

  /** Handler body from `export const name = async` to the closing `};` at column 0. */
  function handlerBody(name: string): string {
    const start = src.indexOf(`export const ${name} = async`);
    if (start < 0) return '';
    const end = src.indexOf('\n};', start);
    return end < 0 ? src.slice(start) : src.slice(start, end);
  }

  const handlerNames = [
    ...new Set(
      Array.from(src.matchAll(/export const ([a-zA-Z]+) = async/g)).map((m) => m[1] as string),
    ),
  ];

  it('finds the handlers to audit', () => {
    expect(handlerNames.length).toBeGreaterThan(10);
  });

  it('no handler writes shipments without clearing the caches', () => {
    const offenders: string[] = [];
    for (const name of handlerNames) {
      const body = handlerBody(name);
      const writesShipments =
        /UPDATE shipments\b/.test(body) ||
        /INSERT INTO shipments\b/.test(body) ||
        /DELETE FROM shipments\b/.test(body);
      if (!writesShipments) continue;
      if (!body.includes('invalidateShipmentsListCache')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('the two daily-deliverables paths in particular still invalidate', () => {
    for (const name of ['updateShipmentDailyDeliverables', 'bulkUploadShipmentDailyDeliverables']) {
      expect(handlerBody(name)).toContain('invalidateShipmentsListCache');
    }
  });
});
