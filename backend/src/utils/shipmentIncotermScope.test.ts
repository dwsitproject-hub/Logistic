import { describe, expect, it } from 'vitest';
import {
  buildShipmentPageSeaIncotermColumnSql,
  buildShipmentPageSeaIncotermScopeSql,
  isShipmentPageSeaIncoterm,
  SHIPMENT_PAGE_SEA_INCOTERMS,
} from './shipmentIncotermScope';

describe('shipmentIncotermScope', () => {
  it('recognizes CIF/FOB/CFR only', () => {
    expect(SHIPMENT_PAGE_SEA_INCOTERMS).toEqual(['CIF', 'FOB', 'CFR']);
    expect(isShipmentPageSeaIncoterm('cif')).toBe(true);
    expect(isShipmentPageSeaIncoterm('FRC')).toBe(false);
    expect(isShipmentPageSeaIncoterm('LCO')).toBe(false);
  });

  it('builds contract and column SQL scopes', () => {
    expect(buildShipmentPageSeaIncotermScopeSql('c')).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(buildShipmentPageSeaIncotermColumnSql('sb.incoterm')).toContain('sb.incoterm');
  });
});
