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

  it('uses the API-resolved name on hydrate, Open or Closed', () => {
    // A vessel name is always mapped from Master Vessel by the effective code, so the API's
    // already-canonicalised `vessel_name` wins in both states. This replaces the old rule that
    // preferred `vessel_name_klip` while Open.
    for (const closed of [false, true]) {
      expect(
        shipmentListHydrateVesselName('VESSEL A', {
          vessel_name: 'BG. ANDALAN 02',
          vessel_name_klip: 'VESSEL B',
          is_contract_sap_closed: closed,
        }),
      ).toBe('BG. ANDALAN 02')
    }
  })

  it('never renders SAP free text stored in vessel_name_klip', () => {
    // shipments.vessel_name is written by the SAP import too, so vessel_name_klip regularly holds
    // SAP's raw string - 545 of the 551 diverging names on the dev database do not exist in
    // Master Vessel at all. The table must show the master form the API resolved.
    expect(
      shipmentListHydrateVesselName('BG.TIGA JAYA 58', {
        vessel_name: 'BG.TIGA JAYA 58',
        vessel_name_klip: 'TEBAR/BG.TIGA JAYA 58',
        is_contract_sap_closed: false,
      }),
    ).toBe('BG.TIGA JAYA 58')
    expect(
      shipmentListHydrateVesselName('PRIMA SAMUDRA IX', {
        vessel_name: 'PRIMA SAMUDRA IX',
        vessel_name_klip: 'Prima Samudra IX',
        is_contract_sap_closed: false,
      }),
    ).toBe('PRIMA SAMUDRA IX')
  })

  it('falls back to the base name when the API sent none', () => {
    expect(
      shipmentListHydrateVesselName('VESSEL A', { vessel_name: '', vessel_name_klip: 'VESSEL B' }),
    ).toBe('VESSEL A')
  })

  it('treats string false as Open', () => {
    expect(isContractSapClosedFlag('false')).toBe(false)
    expect(isContractSapClosedFlag('f')).toBe(false)
    expect(isContractSapClosedFlag(true)).toBe(true)
  })
})
