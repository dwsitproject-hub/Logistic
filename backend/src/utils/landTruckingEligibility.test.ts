import { describe, expect, it } from 'vitest';
import { isLandSapRowEligibleForTruckingCreation } from './landTruckingEligibility';

describe('isLandSapRowEligibleForTruckingCreation', () => {
  it('returns false when all anchor fields empty', () => {
    expect(
      isLandSapRowEligibleForTruckingCreation({
        contract: {},
        shipment: {},
        raw: {},
        trucking: [],
      })
    ).toBe(false);
  });

  it('returns true when STO No is set', () => {
    expect(
      isLandSapRowEligibleForTruckingCreation({
        contract: { sto_no: 'STO-1' },
        shipment: {},
        raw: {},
        trucking: [],
      })
    ).toBe(true);
  });

  it('returns true when truck loading location is set on trucking leg', () => {
    expect(
      isLandSapRowEligibleForTruckingCreation({
        contract: {},
        shipment: {},
        raw: {},
        trucking: [{ sequence: 1, data: { truck_loading_at_starting_location: 'Jakarta' } }],
      })
    ).toBe(true);
  });

  it('returns true when Quantity Delivered in raw is positive', () => {
    expect(
      isLandSapRowEligibleForTruckingCreation({
        contract: {},
        shipment: {},
        raw: { 'Quantity Delivered': '12' },
        trucking: [],
      })
    ).toBe(true);
  });

  it('returns false when STO is only zeros', () => {
    expect(
      isLandSapRowEligibleForTruckingCreation({
        contract: { sto_no: '000' },
        shipment: {},
        raw: {},
        trucking: [],
      })
    ).toBe(false);
  });
});
