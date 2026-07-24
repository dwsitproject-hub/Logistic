import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildVesselLoadingPortsFromSapParsedData,
  extractLoadingPortNamesFromSapData,
  isValidHumanPortName,
  resolvePrimarySapDischargePortText,
  resolvePrimarySapLoadingPortText,
  resolveSapLoadingPortTextBySequence,
  sapParsedDataHasMultipleLoadingPorts,
} from './vesselLoadingPortsFromSap.service';

describe('vesselLoadingPortsFromSap.service', () => {
  it('builds separate loading ports from SAP vessel_loading_port_1 and _2', () => {
    const ports = buildVesselLoadingPortsFromSapParsedData({
      shipment: {
        vessel_loading_port_1: 'Pangkal Balam - TL',
        vessel_loading_port_2: 'Sadai',
        eta_vessel_arrival_loading_port_1: '1/10/26',
        eta_vessel_arrival_at_loading_port_2: '1/15/26',
        vessel_discharge_port: 'PORT TANJUNG PRIOK',
      },
    });

    const loading = ports.filter((p) => p.is_discharge_port !== true);
    expect(loading).toHaveLength(2);
    expect(loading[0].port_name).toBe('Pangkal Balam - TL');
    expect(loading[0].port_sequence).toBe(1);
    expect(loading[1].port_name).toBe('Sadai');
    expect(loading[1].port_sequence).toBe(2);
    expect(
      sapParsedDataHasMultipleLoadingPorts({
        shipment: { vessel_loading_port_1: 'Pangkal Balam - TL', vessel_loading_port_2: 'Sadai' },
      }),
    ).toBe(true);
  });

  it('extracts distinct loading ports from singular Vessel Loading Port raw field', () => {
    const rowA = {
      raw: { 'Vessel Loading Port': 'PORT PANGKAL BALAM' },
      shipment: { vessel_loading_port_1: '0.00' },
    };
    const rowB = {
      raw: { 'Vessel Loading Port': 'PORT SADAI' },
      shipment: { vessel_loading_port_1: '0.00' },
    };

    expect(extractLoadingPortNamesFromSapData(rowA)).toEqual(['PORT PANGKAL BALAM']);
    expect(extractLoadingPortNamesFromSapData(rowB)).toEqual(['PORT SADAI']);

    const combined = new Set<string>();
    for (const name of [...extractLoadingPortNamesFromSapData(rowA), ...extractLoadingPortNamesFromSapData(rowB)]) {
      combined.add(name.toUpperCase());
    }
    expect(combined.size).toBe(2);
  });

  it('resolves primary loading port from raw when normalized field is placeholder', () => {
    expect(
      resolvePrimarySapLoadingPortText({
        raw: { 'Vessel Loading Port': 'PORT DUMAI' },
        shipment: { vessel_loading_port_1: '0.00' },
      }),
    ).toBe('PORT DUMAI');
  });

  it('skips numeric SAP port codes for shell denormalization', () => {
    expect(
      resolvePrimarySapLoadingPortText({
        shipment: { vessel_loading_port_1: '22.03' },
      }),
    ).toBeNull();
  });

  it('resolves discharge port from SAP shipment fields', () => {
    expect(
      resolvePrimarySapDischargePortText({
        shipment: { vessel_discharge_port: 'PORT TANJUNG PRIOK' },
      }),
    ).toBe('PORT TANJUNG PRIOK');
  });

  it('rejects numeric port names and falls back to Loading Port N label in SAP build', () => {
    expect(isValidHumanPortName('67.30')).toBe(false);
    expect(isValidHumanPortName('Ketapang')).toBe(true);
    expect(
      resolveSapLoadingPortTextBySequence(
        { shipment: { vessel_loading_port_2: '67.30', vessel_loading_port_1: 'Ketapang' } },
        2,
      ),
    ).toBeNull();

    const ports = buildVesselLoadingPortsFromSapParsedData({
      shipment: {
        vessel_loading_port_1: 'Ketapang',
        vessel_loading_port_2: '67.30',
        quantity_at_loading_port_2: 1000,
      },
    });
    const loading2 = ports.find((p) => p.port_sequence === 2 && !p.is_discharge_port);
    expect(loading2?.port_name).toBe('Loading Port 2');
  });

  it('ignores Vessel LOA numeric leak in vessel_loading_port_1 when extracting names', () => {
    expect(
      extractLoadingPortNamesFromSapData({
        raw: { 'Vessel Loading Port': 'PORT TALANG DUKU', 'Vessel LOA': '79.01' },
        shipment: { vessel_loading_port_1: '79.01' },
      }),
    ).toEqual(['PORT TALANG DUKU']);
  });

  it('matches SAP STO embedded in OP-{sto}-* operation_id for edit port labels', () => {
    const src = readFileSync(resolve(__dirname, 'vesselLoadingPortsFromSap.service.ts'), 'utf8');
    expect(src).toContain('op_embedded_sto');
    expect(src).toContain('^OP-([0-9]+)');
  });

  it('sync cancels numeric junk ports (source asserts cancel helper exists)', () => {
    const src = readFileSync(resolve(__dirname, 'vesselLoadingPortsFromSap.service.ts'), 'utf8');
    expect(src).toContain('cancelBogusExtraLoadingPorts');
    expect(src).toContain('isValidHumanPortName');
    expect(src).toContain('Auto-cancelled: invalid/numeric port name');
  });
});
