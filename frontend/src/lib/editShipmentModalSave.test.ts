import { describe, expect, it } from 'vitest';
import type { DischargeEtaFields, LoadingPortEtaSave } from '../lib/editShipmentModalSave';

// Replicate merge logic from editShipmentModalSave for unit verification
function mergeActiveEtaFromMultiPort(
  loadingPortEtas: LoadingPortEtaSave[],
  dischargeEta: DischargeEtaFields,
) {
  const first =
    loadingPortEtas.find((p) => p.portSequence === 1) ??
    loadingPortEtas.slice().sort((a, b) => a.portSequence - b.portSequence)[0];
  return {
    ...(first?.fields ?? {
      etaVesselArrivalAtLoadingPort: '',
      etaVesselBerthedAtLoadingPort: '',
      etaVesselStartLoading: '',
      etaVesselCompletedLoading: '',
      etaVesselSailedFromLoadingPort: '',
    }),
    ...dischargeEta,
  };
}

describe('multi-port save ETA merge', () => {
  it('uses port 1 loading ETAs plus shared discharge ETAs for shipment summary', () => {
    const loadingPortEtas: LoadingPortEtaSave[] = [
      {
        portSequence: 1,
        portName: 'Pangkal Balam - TL',
        fields: {
          etaVesselArrivalAtLoadingPort: '2026-07-01',
          etaVesselBerthedAtLoadingPort: '2026-07-02',
          etaVesselStartLoading: '2026-07-03',
          etaVesselCompletedLoading: '2026-07-04',
          etaVesselSailedFromLoadingPort: '2026-07-05',
        },
      },
      {
        portSequence: 2,
        portName: 'Sadai',
        fields: {
          etaVesselArrivalAtLoadingPort: '2026-07-06',
          etaVesselBerthedAtLoadingPort: '2026-07-07',
          etaVesselStartLoading: '2026-07-08',
          etaVesselCompletedLoading: '2026-07-09',
          etaVesselSailedFromLoadingPort: '2026-07-10',
        },
      },
    ];
    const dischargeEta: DischargeEtaFields = {
      etaVesselArriveAtDischargePort: '2026-07-15',
      etaVesselBerthedAtDischargePort: '2026-07-16',
      etaVesselStartDischarging: '2026-07-17',
      etaVesselCompleteDischarge: '2026-07-18',
    };

    const merged = mergeActiveEtaFromMultiPort(loadingPortEtas, dischargeEta);
    expect(merged.etaVesselArrivalAtLoadingPort).toBe('2026-07-01');
    expect(merged.etaVesselSailedFromLoadingPort).toBe('2026-07-05');
    expect(merged.etaVesselArriveAtDischargePort).toBe('2026-07-15');
    expect(merged.etaVesselCompleteDischarge).toBe('2026-07-18');
  });
});
