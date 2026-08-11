import { describe, expect, it } from 'vitest';
import {
  resolveSapDistributionSeaLike,
  shouldMaterializeSapShipment,
} from './sapDistributionRouting';

const baseCtx = {
  isLand: false,
  isSea: false,
  incotermLabel: 'CIF',
  isTruckIncoterm: false,
  hasShipment: true,
  seaEligible: true,
  hasVesselLike: false,
  hasStoInShipment: true,
  parsedData: {
    contract: { incoterm: 'CIF' },
    shipment: { sto_no: '1016010999' },
    raw: { 'STO Type': 'T' },
  },
};

describe('sapDistributionRouting', () => {
  it('routes CIF + LAND + Type T to seaLike via cifCfrSeaLike', () => {
    const result = resolveSapDistributionSeaLike({
      ...baseCtx,
      isLand: true,
      incotermLabel: 'CIF',
    });
    expect(result.cifCfrSeaLike).toBe(true);
    expect(result.landSeaStoLeg).toBe(false);
    expect(result.seaLike).toBe(true);
    expect(shouldMaterializeSapShipment({ ...baseCtx, isLand: true })).toBe(true);
  });

  it('routes CFR without Sea/Land flag via cifCfrSeaLike', () => {
    const result = resolveSapDistributionSeaLike({
      ...baseCtx,
      incotermLabel: 'CFR',
      parsedData: {
        contract: { incoterm: 'CFR' },
        shipment: { sto_no: '1016010888' },
        raw: {},
      },
    });
    expect(result.cifCfrSeaLike).toBe(true);
    expect(result.seaLike).toBe(true);
  });

  it('routes FOB + LAND + Type V via landSeaStoLeg', () => {
    const parsedData = {
      contract: { incoterm: 'FOB' },
      shipment: { sto_no: '1016010266', vessel_name: 'BG. SAHABAT SETIA 2689' },
      raw: { 'STO Type': 'V', 'Vessel Name': 'BG. SAHABAT SETIA 2689' },
    };
    const result = resolveSapDistributionSeaLike({
      ...baseCtx,
      isLand: true,
      incotermLabel: 'FOB',
      hasVesselLike: true,
      parsedData,
    });
    expect(result.landSeaStoLeg).toBe(true);
    expect(result.cifCfrSeaLike).toBe(false);
    expect(result.seaLike).toBe(true);
    expect(
      shouldMaterializeSapShipment({
        ...baseCtx,
        isLand: true,
        incotermLabel: 'FOB',
        hasVesselLike: true,
        parsedData,
      }),
    ).toBe(true);
  });

  it('does not route FOB + LAND + Type T to Shipments', () => {
    const parsedData = {
      contract: { incoterm: 'FOB' },
      shipment: { sto_no: '1016010281' },
      raw: { 'STO Type': 'T' },
    };
    const result = resolveSapDistributionSeaLike({
      ...baseCtx,
      isLand: true,
      incotermLabel: 'FOB',
      parsedData,
    });
    expect(result.landSeaStoLeg).toBe(false);
    expect(result.seaLike).toBe(false);
    expect(
      shouldMaterializeSapShipment({
        ...baseCtx,
        isLand: true,
        incotermLabel: 'FOB',
        parsedData,
      }),
    ).toBe(false);
  });

  it('does not route FRC/LCO truck incoterms even when seaLike would otherwise apply', () => {
    expect(
      shouldMaterializeSapShipment({
        ...baseCtx,
        isTruckIncoterm: true,
        incotermLabel: 'LCO',
      }),
    ).toBe(false);
  });

  it('does not materialize FOB Type T via assumeSea when Sea/Land is blank', () => {
    const parsedData = {
      contract: { incoterm: 'FOB' },
      shipment: { sto_no: '1586004914' },
      raw: { 'STO Type': 'T' },
    };
    const result = resolveSapDistributionSeaLike({
      ...baseCtx,
      incotermLabel: 'FOB',
      parsedData,
    });
    expect(result.assumeSea).toBe(true);
    expect(result.seaLike).toBe(true);
    expect(
      shouldMaterializeSapShipment({
        ...baseCtx,
        incotermLabel: 'FOB',
        parsedData,
      }),
    ).toBe(false);
  });
});
