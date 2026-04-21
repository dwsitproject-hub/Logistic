import { describe, expect, it } from 'vitest';
import { isSeaSapRowEligibleForShipmentCreation } from './seaShipmentEligibility';

describe('isSeaSapRowEligibleForShipmentCreation', () => {
  it('returns false when all anchor fields empty', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: {},
        raw: {},
      })
    ).toBe(false);
  });

  it('returns true when STO No is set', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: { sto_no: 'STO-123' },
        raw: {},
      })
    ).toBe(true);
  });

  it('returns true when Port of Loading is set', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: { vessel_loading_port_1: 'DUMAI' },
        raw: {},
      })
    ).toBe(true);
  });

  it('returns true when Vessel Name is set', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: { vessel_name: 'MV TEST' },
        raw: {},
      })
    ).toBe(true);
  });

  it('returns true when STO Quantity is positive', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: { sto_quantity: '100' },
        shipment: {},
        raw: {},
      })
    ).toBe(true);
  });

  it('returns true when Quantity Delivery is positive', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: { quantity_delivery: '10' },
        raw: {},
      })
    ).toBe(true);
  });

  it('returns true when ATA milestone exists', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: {},
        shipment: { ata_vessel_arrival_at_loading_port_1: '2026-01-01' },
        raw: {},
      })
    ).toBe(true);
  });

  it('returns false when STO is only zeros', () => {
    expect(
      isSeaSapRowEligibleForShipmentCreation({
        contract: { sto_no: '000' },
        shipment: {},
        raw: {},
      })
    ).toBe(false);
  });
});

