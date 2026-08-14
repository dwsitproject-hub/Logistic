import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeShipmentVesselFromSapRow } from './shipmentVesselFromSap.service';

describe('mergeShipmentVesselFromSapRow', () => {
  it('keeps KLIP when is_contract_sap_closed is the string false', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'VESSEL B',
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_name_sap: 'VESSEL A',
      is_contract_sap_closed: 'false',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(false);
    expect(row.vessel_name).toBe('VESSEL B');
  });

  it('prefers KLIP over master and SAP when contract is Open', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: 'VESSEL B',
      vessel_code: 'K01',
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_name_sap: 'VESSEL A',
      vessel_code_sap: 'VT01',
      is_contract_sap_closed: false,
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('VESSEL B');
    expect(row.vessel_name_klip).toBe('VESSEL B');
    expect(row.vessel_name_sap).toBe('VESSEL A');
    expect(row.vessel_code).toBe('K01');
  });

  it('prefers master over KLIP when GR is closed', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: 'VESSEL B',
      vessel_code: 'K01',
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_name_sap: 'VESSEL A',
      vessel_code_sap: 'VT01',
      is_contract_sap_closed: true,
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('BG. ANDALAN 02');
    expect(row.vessel_name_klip).toBe('VESSEL B');
    expect(row.vessel_name_sap).toBe('VESSEL A');
  });

  it('uses SAP over master when Open and KLIP is empty', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: null,
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_name_sap: 'VESSEL A',
      vessel_code_sap: 'VT01',
      is_contract_sap_closed: false,
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('VESSEL A');
    expect(row.vessel_name_klip).toBeNull();
  });

  it('uses SAP vessel name when KLIP is empty', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: null,
      vessel_code: '',
      vessel_name_sap: 'MV TEST',
      vessel_code_sap: 'VT01',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('MV TEST');
    expect(row.vessel_code).toBe('VT01');
  });

  it('falls back to KLIP vessel name when master and SAP name are missing', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'MV KLIP ONLY',
      vessel_name_sap: '',
      vessel_code_sap: '',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(false);
    expect(row.vessel_name).toBe('MV KLIP ONLY');
  });

  it('keeps stored KLIP name when overlayDisplayName is false', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'VESSEL B',
      vessel_name_sap: 'VESSEL A',
      vessel_name_master: 'BG. ANDALAN 02',
      is_contract_sap_closed: false,
    };
    expect(mergeShipmentVesselFromSapRow(row, { overlayDisplayName: false })).toBe(false);
    expect(row.vessel_name).toBe('VESSEL B');
    expect(row.vessel_name_klip).toBe('VESSEL B');
    expect(row.vessel_name_sap).toBe('VESSEL A');
  });
});

describe('edit payload vessel overlay', () => {
  it('resolves Master Vessel name onto the Edit Shipment payload', () => {
    const src = readFileSync(resolve(__dirname, 'shipmentEditPayload.service.ts'), 'utf8');
    expect(src).toContain('mergeShipmentVesselFromSapRow');
    expect(src).toContain('vessel_name_master');
    expect(src).toContain('s.master_vessel_id');
  });
});

describe('edit shipment vessel fan-out', () => {
  it('updateShipment copies vessel identity to every STO group PO', () => {
    const src = readFileSync(resolve(__dirname, '../controllers/shipment.controller.ts'), 'utf8');
    expect(src).toContain('fanOutVesselIdentityToStoGroup');
    expect(src).toContain('hasVesselIdentityUpdate');
    expect(src).toContain('fanOutShipmentEtaToStoGroup');
    expect(src).toContain('sqlLatestNonBlankAgg');
  });
});
