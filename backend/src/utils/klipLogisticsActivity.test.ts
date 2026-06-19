import { describe, expect, it } from 'vitest';
import { isKlipManualShipmentId, isSapSourcedShipmentId } from './klipLogisticsActivity';

describe('klipLogisticsActivity ids', () => {
  it('detects SAP numeric shipment ids', () => {
    expect(isSapSourcedShipmentId('1006018592')).toBe(true);
    expect(isSapSourcedShipmentId('MNL-12345678-1004029379')).toBe(false);
    expect(isSapSourcedShipmentId('MSEA-abc')).toBe(false);
  });

  it('detects KLIP manual shipment ids', () => {
    expect(isKlipManualShipmentId('MNL-123')).toBe(true);
    expect(isKlipManualShipmentId('1006018592')).toBe(false);
  });
});
