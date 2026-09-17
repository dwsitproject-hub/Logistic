import { describe, expect, it } from 'vitest'
import {
  areAllSelectionKeysCif,
  blockSelectionKeysAllCif,
  isCifShipmentIncoterm,
  isEtaScheduleCompleteForCreate,
} from './addNewShipmentEtaRules'

const ETA_KEYS = ['etaVesselArrivalAtLoadingPort', 'etaVesselCompleteDischarge'] as const

describe('addNewShipmentEtaRules', () => {
  it('detects CIF incoterm case-insensitively', () => {
    expect(isCifShipmentIncoterm('cif')).toBe(true)
    expect(isCifShipmentIncoterm('FOB')).toBe(false)
  })

  it('treats all-CIF shipment ETA schedule as complete without dates or loading port', () => {
    const complete = isEtaScheduleCompleteForCreate({
      contractIds: ['po-1', 'po-2'],
      etaBlocks: [],
      etaFieldKeys: ETA_KEYS,
      getIncoterm: () => 'CIF',
    })
    expect(complete).toBe(true)
  })

  it('requires loading port and all ETA fields for non-CIF blocks', () => {
    const incomplete = isEtaScheduleCompleteForCreate({
      contractIds: ['po-1'],
      etaBlocks: [{ contractIds: ['po-1'], loadingPort: '', etaVesselArrivalAtLoadingPort: '', etaVesselCompleteDischarge: '' }],
      etaFieldKeys: ETA_KEYS,
      getIncoterm: () => 'FOB',
    })
    expect(incomplete).toBe(false)

    const complete = isEtaScheduleCompleteForCreate({
      contractIds: ['po-1'],
      etaBlocks: [{
        contractIds: ['po-1'],
        loadingPort: 'Tj Pura',
        etaVesselArrivalAtLoadingPort: '2026-08-01',
        etaVesselCompleteDischarge: '2026-08-10',
      }],
      etaFieldKeys: ETA_KEYS,
      getIncoterm: () => 'FOB',
    })
    expect(complete).toBe(true)
  })

  it('allows CIF PO in mixed shipment without ETA while FOB PO still requires schedule', () => {
    const getIncoterm = (key: string) => (key === 'cif-po' ? 'CIF' : 'FOB')

    expect(areAllSelectionKeysCif(['cif-po', 'fob-po'], getIncoterm)).toBe(false)
    expect(blockSelectionKeysAllCif(['cif-po'], getIncoterm)).toBe(true)

    const partial = isEtaScheduleCompleteForCreate({
      contractIds: ['cif-po', 'fob-po'],
      etaBlocks: [],
      etaFieldKeys: ETA_KEYS,
      getIncoterm,
    })
    expect(partial).toBe(false)
  })
})
