import {
  buildVesselLoadingPortsFromSapParsedData,
  extractLoadingPortNamesFromSapData,
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
});
