import { describe, expect, it } from 'vitest'
import { isKlipEditedField, klipEditedFieldSet } from './klipProvenance'

/**
 * The three states must stay distinct. Collapsing "not recorded" into "came from SAP" would
 * repeat the original bug in mirror image: every row predating migration 167 has an empty array,
 * and so does every row only SAP has ever touched.
 */
describe('klip provenance', () => {
  it('reads the recorded column names', () => {
    const set = klipEditedFieldSet(['ata_vessel_arrival', 'quality_ffa'])
    expect(set.has('ata_vessel_arrival')).toBe(true)
    expect(set.has('quality_ffa')).toBe(true)
  })

  it('treats a missing array as unknown, never as proof of SAP', () => {
    expect(isKlipEditedField(undefined, 'ata_vessel_arrival')).toBe(false)
    expect(isKlipEditedField(null, 'ata_vessel_arrival')).toBe(false)
    expect(isKlipEditedField('ata_vessel_arrival', 'ata_vessel_arrival')).toBe(false)
    expect(klipEditedFieldSet(undefined).size).toBe(0)
  })

  it('does not claim a column that was not recorded', () => {
    expect(isKlipEditedField(['quality_ffa'], 'ata_vessel_arrival')).toBe(false)
  })

  it('ignores blank and whitespace entries', () => {
    expect(klipEditedFieldSet(['', '  ', 'quality_mi']).size).toBe(1)
    expect(isKlipEditedField(['', 'quality_mi'], 'quality_mi')).toBe(true)
  })

  it('accepts a prepared Set, so a long list is not rebuilt per field', () => {
    const set = new Set(['ata_loading_start'])
    expect(isKlipEditedField(set, 'ata_loading_start')).toBe(true)
    expect(isKlipEditedField(set, 'ata_vessel_sailed')).toBe(false)
  })

  it('refuses an empty column name rather than matching something by accident', () => {
    expect(isKlipEditedField(['', 'quality_mi'], '')).toBe(false)
  })
})
