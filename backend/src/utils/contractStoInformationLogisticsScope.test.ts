import { describe, expect, it } from 'vitest';
import { resolveContractStoInformationLogisticsIncludes } from './contractStoInformationLogisticsScope';

describe('resolveContractStoInformationLogisticsIncludes', () => {
  it('CIF/FOB/CFR are shipment-only even when transport_mode is MIX', () => {
    expect(
      resolveContractStoInformationLogisticsIncludes({
        incoterm: 'CIF',
        transportMode: 'MIX',
      }),
    ).toEqual({ includeShipments: true, includeTrucking: false });
    expect(
      resolveContractStoInformationLogisticsIncludes({
        incoterm: 'FOB',
        transportMode: 'MIX',
      }),
    ).toEqual({ includeShipments: true, includeTrucking: false });
  });

  it('FRC/LCO are trucking-only even when transport_mode is MIX', () => {
    expect(
      resolveContractStoInformationLogisticsIncludes({
        incoterm: 'FRC',
        transportMode: 'MIX',
      }),
    ).toEqual({ includeShipments: false, includeTrucking: true });
  });

  it('falls back to transport_mode when incoterm is blank', () => {
    expect(
      resolveContractStoInformationLogisticsIncludes({
        incoterm: '',
        transportMode: 'MIX',
      }),
    ).toEqual({ includeShipments: true, includeTrucking: true });
    expect(
      resolveContractStoInformationLogisticsIncludes({
        incoterm: null,
        transportMode: 'SEA',
      }),
    ).toEqual({ includeShipments: true, includeTrucking: false });
  });
});
