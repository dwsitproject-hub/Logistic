import { describe, expect, it } from 'vitest'
import { describeKlipFieldEdit } from './klipFieldHistory'

/**
 * The tooltip is decoration: the badge is decided by klip_edited_fields. An absent history entry
 * means the edit predates the audit log on that route - never that it did not happen - so the
 * formatter stays silent rather than inventing a phrase.
 */
describe('describeKlipFieldEdit', () => {
  const history = {
    ata_vessel_arrival: { column: 'ata_vessel_arrival', at: '2026-09-12T04:11:00Z', by: 'budi' },
    quality_ffa: { column: 'quality_ffa', at: '2026-09-12T04:11:00Z', by: null },
  }

  it('names the person and the day', () => {
    expect(describeKlipFieldEdit(history, 'ata_vessel_arrival')).toBe('budi, 12/09/2026')
  })

  it('falls back to the date alone when the user is unknown', () => {
    expect(describeKlipFieldEdit(history, 'quality_ffa')).toBe('12/09/2026')
  })

  it('says nothing for a column with no recorded edit', () => {
    expect(describeKlipFieldEdit(history, 'ata_vessel_sailed')).toBeNull()
  })

  it('survives a missing history object', () => {
    expect(describeKlipFieldEdit(undefined, 'ata_vessel_arrival')).toBeNull()
    expect(describeKlipFieldEdit(null, 'ata_vessel_arrival')).toBeNull()
  })
})
