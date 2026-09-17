import { describe, expect, it } from 'vitest';
import {
  applyLiveSapAtaReferences,
  extractSapAtaReferenceMap,
  normalizeSapAtaDate,
} from './sapAtaReferenceFromProcessed';

describe('sapAtaReferenceFromProcessed', () => {
  it('normalizeSapAtaDate parses ISO and leaves blank as null', () => {
    expect(normalizeSapAtaDate('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
    expect(normalizeSapAtaDate('')).toBeNull();
    expect(normalizeSapAtaDate(null)).toBeNull();
  });

  it('extractSapAtaReferenceMap returns nulls when SAP shipment has no ATA', () => {
    const refs = extractSapAtaReferenceMap({});
    expect(refs.ata_vessel_arrive_at_discharge_port).toBeNull();
    expect(refs.ata_vessel_berthed_at_discharge_port).toBeNull();
    expect(refs.ata_vessel_start_discharging).toBeNull();
    expect(refs.ata_vessel_complete_discharge).toBeNull();
  });

  it('extractSapAtaReferenceMap reads discharge aliases', () => {
    const refs = extractSapAtaReferenceMap({
      ata_vessel_arrival_at_discharge_port: '2026-07-10',
      ata_discharging_start_at_discharge_port: '2026-07-11',
      ata_discharging_completed_at_discharge_port: '2026-07-12',
    });
    expect(refs.ata_vessel_arrive_at_discharge_port).toBe('2026-07-10');
    expect(refs.ata_vessel_start_discharging).toBe('2026-07-11');
    expect(refs.ata_vessel_complete_discharge).toBe('2026-07-12');
  });

  it('applyLiveSapAtaReferences clears stale VLP sap_ata when SAP is blank', () => {
    const info: Record<string, unknown> = {
      sap_ata_vessel_arrive_at_discharge_port: '2026-01-01',
    };
    const ports: Record<string, unknown>[] = [
      {
        is_discharge_port: true,
        sap_ata_vessel_arrival: '2026-01-01',
        sap_ata_vessel_berthed: '2026-01-02',
        sap_ata_loading_start: '2026-01-03',
        sap_ata_loading_completed: '2026-01-04',
      },
    ];
    applyLiveSapAtaReferences(info, ports, {});
    expect(info.sap_ata_vessel_arrive_at_discharge_port).toBeNull();
    expect(ports[0].sap_ata_vessel_arrival).toBeNull();
    expect(ports[0].sap_ata_vessel_berthed).toBeNull();
    expect(ports[0].sap_ata_loading_start).toBeNull();
    expect(ports[0].sap_ata_loading_completed).toBeNull();
  });
});
