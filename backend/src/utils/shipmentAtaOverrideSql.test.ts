import { describe, expect, it } from 'vitest';
import {
  sqlEffectiveAtaArrivalLoading,
  sqlKlipStoredAtaArrivalLoading,
  sqlSapAtaArrivalDischarge,
  sqlSapAtaArrivalLoading,
} from './shipmentAtaOverrideSql';

describe('shipmentAtaOverrideSql SAP vs KLIP', () => {
  it('sqlSapAta* reads snapshot columns only — never KLIP stored ATA', () => {
    const loading = sqlSapAtaArrivalLoading();
    const discharge = sqlSapAtaArrivalDischarge();
    expect(loading).toContain('sap_ata_vessel_arrival');
    expect(loading).not.toContain('s.ata_arrival');
    expect(loading).not.toContain('COALESCE');
    expect(discharge).toContain('sap_ata_vessel_arrival');
    expect(discharge).not.toContain('s.ata_discharge_arrival');
  });

  it('effective ATA uses override then KLIP stored, not SAP snapshot', () => {
    const effective = sqlEffectiveAtaArrivalLoading();
    expect(effective).toContain('sao.ata_arrival');
    expect(effective).toContain(sqlKlipStoredAtaArrivalLoading());
    expect(effective).not.toContain('sap_ata_');
  });
});
