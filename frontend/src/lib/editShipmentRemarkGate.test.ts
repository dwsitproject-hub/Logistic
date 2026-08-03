import { describe, expect, it } from 'vitest'
import {
  buildShipmentEtaBaseline,
  hasShipmentAtaEdits,
  hasShipmentEtaEdits,
  hasShipmentQualityEdits,
  resolveCurrentQualityByPortKey,
  type ShipmentEtaBlockSnapshot,
} from './editShipmentRemarkGate'
import { emptyAtaFields } from './shipmentAtaFields'
import { emptyShipmentQualityFields } from './shipmentQualityFields'

const emptyEta = {
  etaVesselArrivalAtLoadingPort: '',
  etaVesselBerthedAtLoadingPort: '',
  etaVesselStartLoading: '',
  etaVesselCompletedLoading: '',
  etaVesselSailedFromLoadingPort: '',
  etaVesselArriveAtDischargePort: '',
  etaVesselBerthedAtDischargePort: '',
  etaVesselStartDischarging: '',
  etaVesselCompleteDischarge: '',
}

function singleBlock(fields: Partial<typeof emptyEta> = {}): ShipmentEtaBlockSnapshot[] {
  return [
    {
      portSequence: 1,
      status: 'active',
      fields: { ...emptyEta, ...fields },
    },
  ]
}

describe('editShipmentRemarkGate', () => {
  it('detects single-port ETA date change', () => {
    const blocks = singleBlock({ etaVesselArrivalAtLoadingPort: '2026-07-01' })
    const baseline = buildShipmentEtaBaseline({
      isMultiPortLoading: false,
      dischargeEta: emptyEta,
      etaBlocks: blocks,
    })
    const edited = singleBlock({ etaVesselArrivalAtLoadingPort: '2026-07-05' })
    expect(
      hasShipmentEtaEdits(baseline, {
        isMultiPortLoading: false,
        dischargeEta: emptyEta,
        etaBlocks: edited,
      }),
    ).toBe(true)
  })

  it('detects new draft ETA block', () => {
    const blocks = singleBlock({ etaVesselArrivalAtLoadingPort: '2026-07-01' })
    const baseline = buildShipmentEtaBaseline({
      isMultiPortLoading: false,
      dischargeEta: emptyEta,
      etaBlocks: blocks,
    })
    const draft: ShipmentEtaBlockSnapshot[] = [
      { portSequence: 1, status: 'historical', fields: { ...emptyEta, etaVesselArrivalAtLoadingPort: '2026-07-01' } },
      { portSequence: 1, status: 'active', isDraft: true, fields: emptyEta },
    ]
    expect(
      hasShipmentEtaEdits(baseline, {
        isMultiPortLoading: false,
        dischargeEta: emptyEta,
        etaBlocks: draft,
      }),
    ).toBe(true)
  })

  it('ignores unchanged ETA', () => {
    const blocks = singleBlock({ etaVesselArrivalAtLoadingPort: '2026-07-01T00:00:00Z' })
    const baseline = buildShipmentEtaBaseline({
      isMultiPortLoading: false,
      dischargeEta: emptyEta,
      etaBlocks: blocks,
    })
    expect(
      hasShipmentEtaEdits(baseline, {
        isMultiPortLoading: false,
        dischargeEta: emptyEta,
        etaBlocks: singleBlock({ etaVesselArrivalAtLoadingPort: '2026-07-01' }),
      }),
    ).toBe(false)
  })

  it('detects single-port ATA date change', () => {
    const original = emptyAtaFields()
    original.ata_vessel_arrival_at_loading_port = '2026-07-01'
    const edited = { ...original, ata_vessel_arrival_at_loading_port: '2026-07-05' }
    expect(
      hasShipmentAtaEdits({
        isMultiPortLoading: false,
        ataFields: edited,
        originalAtaFields: original,
        loadingPortAtaByKey: {},
        originalLoadingPortAtaByKey: {},
      }),
    ).toBe(true)
  })

  it('detects multi-port loading ATA change', () => {
    const baseline = {
      port1: {
        ata_vessel_arrival_at_loading_port: '2026-07-01',
        ata_vessel_berthed_at_loading_port: '',
        ata_vessel_start_loading: '',
        ata_vessel_completed_loading: '',
        ata_vessel_sailed_from_loading_port: '',
      },
    }
    const edited = {
      ...baseline,
      port1: { ...baseline.port1, ata_vessel_berthed_at_loading_port: '2026-07-02' },
    }
    expect(
      hasShipmentAtaEdits({
        isMultiPortLoading: true,
        ataFields: emptyAtaFields(),
        originalAtaFields: emptyAtaFields(),
        loadingPortAtaByKey: edited,
        originalLoadingPortAtaByKey: baseline,
      }),
    ).toBe(true)
  })

  it('detects quality metric change', () => {
    const baseline = { port1: { ...emptyShipmentQualityFields(), quality_ffa: 0.5 } }
    const current = resolveCurrentQualityByPortKey(baseline, {
      port1: { ...emptyShipmentQualityFields(), quality_ffa: 0.6 },
    })
    expect(hasShipmentQualityEdits(baseline, current)).toBe(true)
  })

  it('ignores unchanged quality', () => {
    const baseline = { port1: { ...emptyShipmentQualityFields(), quality_dobi: 2.1 } }
    const current = resolveCurrentQualityByPortKey(baseline, {})
    expect(hasShipmentQualityEdits(baseline, current)).toBe(false)
  })
})
