import { describe, expect, it } from 'vitest';
import { SHIPMENT_WARM_TOOLBAR_SCOPES } from './shipmentSummaryWarmer.service';

describe('SHIPMENT_WARM_TOOLBAR_SCOPES', () => {
  it('includes default YTD plus CPO×Bontang high-traffic scopes', () => {
    expect(SHIPMENT_WARM_TOOLBAR_SCOPES.some((s) => !s.plants && !s.products)).toBe(true);
    expect(
      SHIPMENT_WARM_TOOLBAR_SCOPES.some(
        (s) => s.products?.includes('CPO') && s.plants?.includes('Bontang'),
      ),
    ).toBe(true);
    expect(SHIPMENT_WARM_TOOLBAR_SCOPES.some((s) => s.label === 'CPO' && s.products?.[0] === 'CPO')).toBe(
      true,
    );
  });
});
