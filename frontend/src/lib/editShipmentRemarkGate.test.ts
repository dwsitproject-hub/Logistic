import { describe, expect, it } from 'vitest'
import {
  buildShipmentEtaBaseline,
  hasShipmentEtaEdits,
  type ShipmentEtaBlockSnapshot,
} from './editShipmentRemarkGate'

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
})
