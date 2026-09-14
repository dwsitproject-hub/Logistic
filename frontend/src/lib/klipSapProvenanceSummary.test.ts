import { describe, expect, it } from 'vitest'
import { describePortProvenance, summarizePortProvenance } from './klipSapProvenanceSummary'

describe('summarizePortProvenance', () => {
  it('counts only fields that disagree with SAP', () => {
    const ports = [
      {
        ata_vessel_arrival: '2026-09-10',
        sap_ata_vessel_arrival: '2026-09-10', // agrees - not worth a reviewer's time
        ata_vessel_berthed: '2026-09-12',
        sap_ata_vessel_berthed: '2026-09-11', // differs
        klip_edited_fields: [],
      },
    ]
    const s = summarizePortProvenance(ports)
    expect(s.differing).toBe(1)
    expect(s.unrecorded).toBe(1)
    expect(s.klipRecorded).toBe(0)
  })

  it('separates recorded edits from unknown provenance', () => {
    const ports = [
      {
        ata_vessel_arrival: '2026-09-12',
        sap_ata_vessel_arrival: '2026-09-10',
        quality_ffa: 3.5,
        sap_quality_ffa: 3.1,
        klip_edited_fields: ['ata_vessel_arrival'],
      },
    ]
    const s = summarizePortProvenance(ports)
    expect(s.differing).toBe(2)
    expect(s.klipRecorded).toBe(1)
    expect(s.unrecorded).toBe(1)
  })

  it('ignores empty values - nothing to compare', () => {
    const ports = [{ ata_vessel_arrival: null, sap_ata_vessel_arrival: '2026-09-10' }]
    expect(summarizePortProvenance(ports).differing).toBe(0)
  })

  it('ignores a field SAP never reported, which cannot be a disagreement', () => {
    const ports = [{ ata_vessel_arrival: '2026-09-12', sap_ata_vessel_arrival: null }]
    expect(summarizePortProvenance(ports).differing).toBe(0)
  })

  it('counts across every port, not just the first', () => {
    const ports = [
      { ata_vessel_arrival: '2026-09-12', sap_ata_vessel_arrival: '2026-09-10' },
      { ata_vessel_arrival: '2026-09-13', sap_ata_vessel_arrival: '2026-09-10' },
    ]
    expect(summarizePortProvenance(ports).differing).toBe(2)
  })

  it('survives missing or malformed input', () => {
    expect(summarizePortProvenance(undefined).differing).toBe(0)
    expect(summarizePortProvenance(null).differing).toBe(0)
    expect(summarizePortProvenance([]).differing).toBe(0)
  })
})

describe('describePortProvenance', () => {
  it('says nothing when nothing differs', () => {
    expect(describePortProvenance({ differing: 0, klipRecorded: 0, unrecorded: 0 })).toBeNull()
  })

  it('names both halves when both are present', () => {
    const text = describePortProvenance({ differing: 12, klipRecorded: 3, unrecorded: 9 })
    expect(text).toContain('12 field berbeda dari SAP')
    expect(text).toContain('3 diubah lewat KLIP')
    expect(text).toContain('9 asal belum tercatat')
  })

  it('omits a half that is zero rather than printing "0"', () => {
    const text = describePortProvenance({ differing: 3, klipRecorded: 3, unrecorded: 0 })
    expect(text).toContain('3 diubah lewat KLIP')
    expect(text).not.toContain('belum tercatat')
  })
})
