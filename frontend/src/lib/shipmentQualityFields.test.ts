import { describe, expect, it } from 'vitest'
import { qualitySapReferenceFromPort, shipmentQualityFieldsFromPort } from './shipmentQualityFields'

describe('qualitySapReferenceFromPort', () => {
  it('reads sap_quality_* only and does not fall back to KLIP quality_*', () => {
    expect(
      qualitySapReferenceFromPort({
        quality_ffa: 0.42,
        sap_quality_ffa: null,
        sap_quality_mi: 0.15,
      }),
    ).toEqual({
      quality_ffa: null,
      quality_mi: 0.15,
      quality_dobi: null,
      quality_red: null,
      quality_ds: null,
      quality_stone: null,
    })
  })

  it('treats SAP 0.000 as empty so the chip shows —', () => {
    expect(
      qualitySapReferenceFromPort({
        sap_quality_ffa: 0,
        sap_quality_mi: '0.000',
        sap_quality_dobi: 0.25,
      }).quality_ffa,
    ).toBeNull()
    expect(
      qualitySapReferenceFromPort({
        sap_quality_ffa: 0,
        sap_quality_mi: '0.000',
        sap_quality_dobi: 0.25,
      }).quality_mi,
    ).toBeNull()
    expect(
      qualitySapReferenceFromPort({
        sap_quality_ffa: 0,
        sap_quality_mi: '0.000',
        sap_quality_dobi: 0.25,
      }).quality_dobi,
    ).toBe(0.25)
  })
})

describe('shipmentQualityFieldsFromPort', () => {
  it('keeps KLIP stored quality independent of SAP snapshot', () => {
    expect(
      shipmentQualityFieldsFromPort(
        { quality_ffa: 0.42, sap_quality_ffa: null },
        {},
        'quality_at_loading_loc_1',
      ).quality_ffa,
    ).toBe(0.42)
  })
})
