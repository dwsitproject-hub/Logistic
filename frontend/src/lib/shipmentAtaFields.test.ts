import {
  buildAtaOverridePayload,
  dischargeAtaSapFromPortRow,
  emptyAtaFields,
  loadingAtaSapFromPortRow,
  resolveAtaSapReferenceValue,
} from './shipmentAtaFields';

describe('buildAtaOverridePayload', () => {
  it('returns null when nothing changed', () => {
    const base = emptyAtaFields();
    base.ata_vessel_arrival_at_loading_port = '2024-01-01';
    expect(buildAtaOverridePayload(base, base)).toBeNull();
  });

  it('includes changed fields only', () => {
    const base = emptyAtaFields();
    const current = { ...base, ata_vessel_arrival_at_loading_port: '2024-02-01' };
    expect(buildAtaOverridePayload(current, base)).toEqual({
      ata_vessel_arrival_at_loading_port: '2024-02-01',
    });
  });

  it('sends null to clear override back to SAP fallback', () => {
    const base = emptyAtaFields();
    base.ata_vessel_arrival_at_loading_port = '2024-02-01';
    const current = { ...base, ata_vessel_arrival_at_loading_port: '' };
    expect(buildAtaOverridePayload(current, base)).toEqual({
      ata_vessel_arrival_at_loading_port: null,
    });
  });
});

describe('port-row SAP ATA snapshots', () => {
  it('loadingAtaSapFromPortRow does not fall back to KLIP ata_*', () => {
    expect(
      loadingAtaSapFromPortRow({
        ata_vessel_arrival: '2026-07-01',
        sap_ata_vessel_arrival: null,
      }),
    ).toEqual({
      ata_vessel_arrival_at_loading_port: '',
      ata_vessel_berthed_at_loading_port: '',
      ata_vessel_start_loading: '',
      ata_vessel_completed_loading: '',
      ata_vessel_sailed_from_loading_port: '',
    });
  });

  it('dischargeAtaSapFromPortRow reads sap_ata_* only', () => {
    expect(
      dischargeAtaSapFromPortRow({
        ata_vessel_arrival: '2026-08-01',
        sap_ata_vessel_arrival: '2026-07-15',
        sap_ata_loading_completed: '2026-07-20',
      }),
    ).toEqual({
      ata_vessel_arrive_at_discharge_port: '2026-07-15',
      ata_vessel_berthed_at_discharge_port: '',
      ata_vessel_start_discharging: '',
      ata_vessel_complete_discharge: '2026-07-20',
    });
  });
});

describe('resolveAtaSapReferenceValue', () => {
  const emptySap = emptyAtaFields();

  it('does not leak loading-port sap_ata into discharge SAP chips', () => {
    const loadingPort = {
      is_discharge_port: false,
      sap_ata_vessel_arrival: '2026-07-22',
      sap_ata_vessel_berthed: '2026-07-23',
      sap_ata_loading_start: '2026-07-23',
      sap_ata_loading_completed: '2026-07-24',
    };
    const dischargePort = {
      is_discharge_port: true,
      sap_ata_vessel_arrival: null,
      sap_ata_vessel_berthed: null,
      sap_ata_loading_start: null,
      sap_ata_loading_completed: null,
    };

    expect(
      resolveAtaSapReferenceValue('ata_vessel_arrive_at_discharge_port', {
        loadingPortRow: loadingPort,
        dischargePortRow: dischargePort,
        shipmentSapRef: emptySap,
      }),
    ).toBe('');
    expect(
      resolveAtaSapReferenceValue('ata_vessel_berthed_at_discharge_port', {
        loadingPortRow: loadingPort,
        dischargePortRow: dischargePort,
        shipmentSapRef: emptySap,
      }),
    ).toBe('');
    expect(
      resolveAtaSapReferenceValue('ata_vessel_start_discharging', {
        loadingPortRow: loadingPort,
        dischargePortRow: dischargePort,
        shipmentSapRef: emptySap,
      }),
    ).toBe('');
    expect(
      resolveAtaSapReferenceValue('ata_vessel_complete_discharge', {
        loadingPortRow: loadingPort,
        dischargePortRow: dischargePort,
        shipmentSapRef: emptySap,
      }),
    ).toBe('');
  });

  it('still reads loading sap_ata for loading ATA keys', () => {
    expect(
      resolveAtaSapReferenceValue('ata_vessel_arrival_at_loading_port', {
        loadingPortRow: { sap_ata_vessel_arrival: '2026-07-22' },
        dischargePortRow: { sap_ata_vessel_arrival: '2026-08-01' },
        shipmentSapRef: emptySap,
      }),
    ).toBe('2026-07-22');
  });

  it('falls back to shipmentSapRef when discharge port sap_ata is blank', () => {
    const shipmentSapRef = emptyAtaFields();
    shipmentSapRef.ata_vessel_arrive_at_discharge_port = '2026-07-10';
    expect(
      resolveAtaSapReferenceValue('ata_vessel_arrive_at_discharge_port', {
        loadingPortRow: { sap_ata_vessel_arrival: '2026-07-22' },
        dischargePortRow: { sap_ata_vessel_arrival: null },
        shipmentSapRef,
      }),
    ).toBe('2026-07-10');
  });
});
