import { describe, expect, it } from 'vitest'
import {
  hasKlipVesselNameOverride,
  isContractSapClosedFlag,
  shipmentListHydrateVesselName,
  shipmentVesselPrimaryName,
} from './shipmentVesselCompare'

describe('shipmentVesselCompare', () => {
  it('treats empty KLIP as SAP-primary (no override)', () => {
    expect(hasKlipVesselNameOverride('', 'VESSEL A')).toBe(false)
    expect(shipmentVesselPrimaryName('', 'VESSEL A')).toBe('VESSEL A')
  })

  it('uses KLIP as primary when it differs from SAP (Open)', () => {
    expect(hasKlipVesselNameOverride('VESSEL B', 'VESSEL A')).toBe(true)
    expect(shipmentVesselPrimaryName('VESSEL B', 'VESSEL A')).toBe('VESSEL B')
  })

  it('does not prefer Master over KLIP when Open', () => {
    expect(
      shipmentVesselPrimaryName('VESSEL B', 'VESSEL A', {
        masterName: 'BG. ANDALAN 02',
        contractSapClosed: false,
      }),
    ).toBe('VESSEL B')
  })

  it('prefers Master when GR is Closed', () => {
    expect(
      shipmentVesselPrimaryName('VESSEL B', 'VESSEL A', {
        masterName: 'BG. ANDALAN 02',
        contractSapClosed: true,
      }),
    ).toBe('BG. ANDALAN 02')
  })

  it('does not treat matching names as an override', () => {
    expect(hasKlipVesselNameOverride('VESSEL A', 'vessel a')).toBe(false)
    expect(shipmentVesselPrimaryName('VESSEL A', 'vessel a')).toBe('VESSEL A')
  })

  it('keeps the edited KLIP name on hydrate when GR is Open', () => {
    expect(
      shipmentListHydrateVesselName('VESSEL A', {
        vessel_name: 'BG. ANDALAN 02',
        vessel_name_klip: 'VESSEL B',
        is_contract_sap_closed: false,
      }),
    ).toBe('VESSEL B')
  })

  it('uses overlay name on hydrate when GR is Closed', () => {
    expect(
      shipmentListHydrateVesselName('VESSEL B', {
        vessel_name: 'BG. ANDALAN 02',
        vessel_name_klip: 'VESSEL B',
        is_contract_sap_closed: true,
      }),
    ).toBe('BG. ANDALAN 02')
  })

  it('treats string false as Open', () => {
    expect(isContractSapClosedFlag('false')).toBe(false)
    expect(isContractSapClosedFlag('f')).toBe(false)
    expect(isContractSapClosedFlag(true)).toBe(true)
  })
})
