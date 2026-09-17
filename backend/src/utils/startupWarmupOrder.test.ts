import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The startup queue's guarantee - one heavy query in flight - only holds for a job that returns
 * its promise. A warmer declared `: void` is spaced 5s apart and then runs on into the jobs after
 * it, which is invisible until someone reads a log: measured on the dev host 2026-09-09, Shipping
 * Performance, Trucking and Oil Loss were all still running throughout the heaviest job in the
 * queue, and the hydrate scope load took 206s against 25s for the shell.
 *
 * A future edit could reintroduce `void` (or move the scope warmer back to the end) with nothing
 * failing, so these read the source. They assert scheduling only - no warmer is called here, and
 * nothing about what any of them computes is checked.
 */
const src = (relative: string) => readFileSync(join(__dirname, '..', relative), 'utf8');

describe('startup warmer scheduling', () => {
  it('every warmer the queue registers returns a promise, so the queue can sequence it', () => {
    for (const [file, fn] of [
      ['services/shippingPerformance.service.ts', 'startShippingPerformanceCacheWarmer'],
      ['services/truckingList.service.ts', 'startTruckingListCacheWarmer'],
      ['services/oilLoss.service.ts', 'startOilLossCacheWarmer'],
      ['services/shipmentSummaryWarmer.service.ts', 'startShipmentRowSetScopeWarmer'],
      ['services/shipmentSummaryWarmer.service.ts', 'startShipmentListShellCacheWarmer'],
      ['services/shipmentSummaryWarmer.service.ts', 'startShipmentSummaryCacheWarmer'],
      ['services/shipmentSummaryWarmer.service.ts', 'startShipmentOutstandingQtyCacheWarmer'],
      ['services/shipmentSummaryWarmer.service.ts', 'startShipmentScopedToolbarCacheWarmer'],
    ] as const) {
      const source = src(file);
      const at = source.indexOf(`function ${fn}(`);
      expect(at, `${fn} not found in ${file}`).toBeGreaterThan(-1);
      /** Everything between the parameter list and the body is the declared return type. */
      const returnType = source.slice(source.indexOf(')', at) + 1, source.indexOf('{', at));
      expect(returnType, `${fn} must return a promise for the queue to sequence it`).toContain(
        'Promise',
      );
    }
  });

  it('the scope row-set warmer runs before the toolbar and other-page warmers', () => {
    const server = src('server.ts');
    const at = (name: string) => {
      const index = server.indexOf(`{ name: '${name}'`) >= 0
        ? server.indexOf(`{ name: '${name}'`)
        : server.indexOf(`name: '${name}'`);
      expect(index, `job '${name}' not registered`).toBeGreaterThan(-1);
      return index;
    };

    // Section 1 comes first: it is what a visitor sees before any status card is clicked.
    expect(at('Shipments summary')).toBeLessThan(at('Shipments scope row sets'));
    expect(at('Shipments outstanding qty')).toBeLessThan(at('Shipments scope row sets'));

    // Everything below is secondary, so the heaviest Shipments job no longer waits behind it.
    for (const later of [
      'Shipments scoped toolbar (plant×product)',
      'Shipping Performance',
      'Trucking summary',
      'Oil Loss',
    ]) {
      expect(at('Shipments scope row sets'), `must run before ${later}`).toBeLessThan(at(later));
    }
  });
});
