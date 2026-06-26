import { describe, expect, it } from 'vitest';
import {
  isKlipManualShipmentId,
  isPlaceholderShipmentEligibleForSapConsolidate,
  isSapSourcedShipmentId,
} from './klipLogisticsActivity';

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

describe('isPlaceholderShipmentEligibleForSapConsolidate', () => {
  it('allows MNL placeholders in planned status', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('PLANNED', 'MNL-abc')).toBe(true);
  });

  it('blocks COMPLETED SAP shipments from auto-cancel', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('COMPLETED', '1006018592')).toBe(false);
  });

  it('blocks in-progress SAP numeric STO rows', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('IN_TRANSIT', '1006018592')).toBe(false);
  });

  it('blocks already cancelled rows', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('CANCELLED', 'MNL-x')).toBe(false);
  });
});

describe('finalizeSapShipmentAfterUpsert', () => {
  it('is exported and returns empty cancel lists (upsert-only, no auto-cancel)', async () => {
    const { finalizeSapShipmentAfterUpsert } = await import('./klipLogisticsActivity');
    const fakeDb = {
      query: async () => ({ rows: [] }),
    };
    const result = await finalizeSapShipmentAfterUpsert(fakeDb, '', '', null);
    expect(result.cancelledShipmentIds).toEqual([]);
    expect(result.skippedShipmentIds).toEqual([]);
  });
});
