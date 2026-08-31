import { describe, expect, it } from 'vitest';
import { sapDischargeDestinationSql } from './sapTruckingLoadingLocationSql';

describe('sapDischargeDestinationSql', () => {
  it('reads Discharge Destination from shipment and raw SAP paths', () => {
    expect(sapDischargeDestinationSql).toContain("shipment'->>'discharge_destination'");
    expect(sapDischargeDestinationSql).toContain("'Discharge Destination'");
  });
});
