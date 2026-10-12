import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildVesselLoadingPortsFromSapParsedData,
  extractLoadingPortNamesFromSapData,
  isValidHumanPortName,
  matchSapPortNameForPortRow,
  mergeSapQualitySnapshot,
  mergeSapSnapshot,
  resolvePrimarySapDischargePortText,
  resolvePrimarySapLoadingPortText,
  resolveSapLoadingPortTextBySequence,
  sapLoadingPortSequenceKey,
  sapPortNameForLoadingPort,
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

  it('rejects numeric port names and skips invalid loading-port sequences', () => {
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
    expect(loading2).toBeUndefined();
    expect(ports.find((p) => p.port_sequence === 1 && !p.is_discharge_port)?.port_name).toBe('Ketapang');
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

  it('resolves edit SAP ports by list sto_key including JSON STO No.', () => {
    const src = readFileSync(resolve(__dirname, 'vesselLoadingPortsFromSap.service.ts'), 'utf8');
    expect(src).toContain('sapStoNumberKeyExpr');
    expect(src).toContain('NULLIF(TRIM($2::text), \'\')');
  });

  it('maps missing/zero VLP sequence onto SAP loading port 1', () => {
    expect(sapLoadingPortSequenceKey(0)).toBe(1);
    expect(sapLoadingPortSequenceKey(null)).toBe(1);
    expect(sapLoadingPortSequenceKey(1)).toBe(1);
    expect(sapLoadingPortSequenceKey(2)).toBe(2);
    expect(sapLoadingPortSequenceKey(3)).toBe(3);
  });

  it('clears SAP snapshot when latest import is blank, including quality 0', () => {
    expect(mergeSapSnapshot(null, '2026-01-01')).toBeNull();
    expect(mergeSapSnapshot('', '2026-01-01')).toBeNull();
    expect(mergeSapSnapshot('2026-02-01', '2026-01-01')).toBe('2026-02-01');
    expect(mergeSapQualitySnapshot(0)).toBeNull();
    expect(mergeSapQualitySnapshot('0.000')).toBeNull();
    expect(mergeSapQualitySnapshot(0.25)).toBe(0.25);
  });

  it('sync cancels numeric junk ports (source asserts cancel helper exists)', () => {
    const src = readFileSync(resolve(__dirname, 'vesselLoadingPortsFromSap.service.ts'), 'utf8');
    expect(src).toContain('cancelBogusExtraLoadingPorts');
    expect(src).toContain('isValidHumanPortName');
    expect(src).toContain('Auto-cancelled: invalid/numeric port name');
  });
});

describe('matchSapPortNameForPortRow (SAP vs KLIP badge on a loading port)', () => {
  const sapNames = ['PORT TELUK PANDAN', 'SADAI'];

  it('a port SAP reported in another slot is SAP\'s, so port 2 is not called KLIP', () => {
    // Port 2 is numbered by the plan builder; SAP filed SADAI under a different row's slot 1.
    expect(matchSapPortNameForPortRow('SADAI', sapNames)).toBe('SADAI');
  });

  it('ignores case, spacing and the PORT prefix', () => {
    expect(matchSapPortNameForPortRow(' teluk  pandan ', sapNames)).toBe('teluk  pandan');
  });

  it('matches through the master display name the plan stores instead of SAP\'s raw text', () => {
    const display = new Map([['TELUK PANDAN', 'TELUK PANDAN - TL']]);
    expect(matchSapPortNameForPortRow('Teluk Pandan - TL', sapNames, display)).toBe('Teluk Pandan - TL');
  });

  it('a name SAP never reported is the user\'s and has no SAP counterpart', () => {
    expect(matchSapPortNameForPortRow('PANGKAL BALAM', sapNames)).toBeNull();
  });

  it('a blank or placeholder name never matches', () => {
    expect(matchSapPortNameForPortRow('', sapNames)).toBeNull();
    expect(matchSapPortNameForPortRow(null, sapNames)).toBeNull();
    expect(matchSapPortNameForPortRow('0.00', ['0.00'])).toBeNull();
  });
});

describe('sapPortNameForLoadingPort (recorded user edit vs name match)', () => {
  const allSapNames = ['PORT TELUK PANDAN', 'SADAI'];

  it('without a record, a name SAP reported is SAP\'s', () => {
    expect(
      sapPortNameForLoadingPort({
        portName: 'SADAI',
        klipEditedFields: [],
        allSapNames,
        slotSapName: 'PORT TELUK PANDAN',
      }),
    ).toBe('SADAI');
  });

  it('a user who picked another port SAP also reported is not called SAP', () => {
    // Port 1 was TELUK PANDAN in SAP; the user switched it to SADAI, which SAP reported for port 2.
    expect(
      sapPortNameForLoadingPort({
        portName: 'SADAI',
        klipEditedFields: ['port_name'],
        allSapNames,
        slotSapName: 'PORT TELUK PANDAN',
      }),
    ).toBe('PORT TELUK PANDAN');
  });

  it('a recorded edit with no SAP value in that slot has no SAP counterpart', () => {
    expect(
      sapPortNameForLoadingPort({
        portName: 'SADAI',
        klipEditedFields: ['port_name'],
        allSapNames,
        slotSapName: undefined,
      }),
    ).toBeNull();
  });

  it('other recorded fields do not count as a port name edit', () => {
    expect(
      sapPortNameForLoadingPort({
        portName: 'SADAI',
        klipEditedFields: ['ata_vessel_arrival'],
        allSapNames,
        slotSapName: null,
      }),
    ).toBe('SADAI');
  });
});
