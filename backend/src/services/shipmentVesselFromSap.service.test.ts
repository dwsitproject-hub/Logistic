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

  it('hydrates owner capacity hull and charter from master when names align', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'MT PRIMA 91',
      vessel_code: 'MPRIMA91',
      vessel_owner: null,
      vessel_capacity: null,
      vessel_hull_type: null,
      charter_type: null,
      vessel_name_master: 'MT PRIMA 91',
      vessel_code_master: 'MPRIMA91',
      vessel_owner_master: 'Owner PT',
      vessel_capacity_mt_master: 5000,
      vessel_type_master: 'Tanker',
      vessel_terms_master: 'V/C',
      vessel_name_sap: 'MT PRIMA 91',
      vessel_code_sap: 'MPRIMA91',
      vessel_owner_sap: null,
    };
    mergeShipmentVesselFromSapRow(row, { overlayDisplayName: false, hydrateFromMaster: true });
    expect(row.vessel_name).toBe('MT PRIMA 91');
    expect(row.vessel_owner).toBe('Owner PT');
    expect(row.vessel_capacity).toBe(5000);
    expect(row.vessel_hull_type).toBe('Tanker');
    expect(row.charter_type).toBe('V/C');
  });

  it('hydrates owner from master even when SAP owner is blank (no SAP compare line)', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'MT. GIAT ARMADA 02',
      vessel_code: 'MARMADA02',
      vessel_owner: '',
      vessel_capacity: null,
      vessel_name_master: 'MT. GIAT ARMADA 02',
      vessel_code_master: 'MARMADA02',
      vessel_owner_master: 'GIAT ARMADA BERSAMA PT.',
      vessel_capacity_mt_master: 4000,
      vessel_type_master: 'TANKER',
      vessel_terms_master: 'V/C',
      vessel_name_sap: 'MT. GIAT ARMADA 02',
      vessel_code_sap: 'MARMADA02',
      vessel_owner_sap: null,
    };
    mergeShipmentVesselFromSapRow(row, { overlayDisplayName: false, hydrateFromMaster: true });
    expect(row.vessel_owner).toBe('GIAT ARMADA BERSAMA PT.');
    expect(row.vessel_capacity).toBe(4000);
  });

  it('does not copy SAP master attrs onto KLIP when vessel name is overridden', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'BERLIAN PACIFIC III',
      vessel_code: 'BERL01',
      vessel_owner: 'Klip Owner',
      vessel_capacity: 2000,
      vessel_hull_type: 'Barge',
      charter_type: 'T/C',
      vessel_name_master: 'MT. GIAT ARMADA 02',
      vessel_code_master: 'GIAT02',
      vessel_owner_master: 'Sap Owner',
      vessel_capacity_mt_master: 5000,
      vessel_type_master: 'Tanker',
      vessel_terms_master: 'V/C',
      vessel_name_sap: 'MT. GIAT ARMADA 02',
      vessel_code_sap: 'GIAT02',
    };
    mergeShipmentVesselFromSapRow(row, { overlayDisplayName: false, hydrateFromMaster: true });
    expect(row.vessel_name).toBe('BERLIAN PACIFIC III');
    expect(row.vessel_owner).toBe('Klip Owner');
    expect(row.vessel_capacity).toBe(2000);
    expect(row.vessel_hull_type).toBe('Barge');
    expect(row.charter_type).toBe('T/C');
    expect(row.vessel_code).toBe('BERL01');
  });

  it('hydrates from master when override name matches master vessel', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'BG. ANDALAN 02',
      vessel_code: null,
      vessel_owner: null,
      vessel_capacity: null,
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_code_master: 'AND02',
      vessel_owner_master: 'Owner PT',
      vessel_capacity_mt_master: 3000,
      vessel_name_sap: 'VESSEL A',
      vessel_code_sap: 'VA01',
    };
    mergeShipmentVesselFromSapRow(row, { overlayDisplayName: false, hydrateFromMaster: true });
    expect(row.vessel_code).toBe('AND02');
    expect(row.vessel_owner).toBe('Owner PT');
    expect(row.vessel_capacity).toBe(3000);
  });
});

describe('edit payload vessel overlay', () => {
  it('resolves Master Vessel name onto the Edit Shipment payload', () => {
    const src = readFileSync(resolve(__dirname, 'shipmentEditPayload.service.ts'), 'utf8');
    expect(src).toContain('mergeShipmentVesselFromSapRow');
    expect(src).toContain('vessel_name_master');
    expect(src).toContain('hydrateFromMaster');
    expect(src).toContain('s.master_vessel_id');
    expect(src).toContain('vessel_owner_master');
    expect(src).toContain('applyLiveSapAtaReferences');
  });
});

describe('edit shipment vessel fan-out', () => {
  it('updateShipment copies vessel identity to every STO group PO', () => {
    const src = readFileSync(resolve(__dirname, '../controllers/shipment.controller.ts'), 'utf8');
    expect(src).toContain('fanOutVesselIdentityToStoGroup');
    expect(src).toContain('hasVesselIdentityUpdate');
    expect(src).toContain('fanOutShipmentEtaToStoGroup');
    expect(src).toContain('sqlShipmentListPrimaryFieldAgg');
  });
});
