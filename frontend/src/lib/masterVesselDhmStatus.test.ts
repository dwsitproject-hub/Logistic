import { describe, expect, it } from 'vitest'
import { dhmStatusHint, isMasterVesselDhmSynced, masterVesselDhmStatusLabel } from './masterVesselDhmStatus'

describe('masterVesselDhmStatus', () => {
  it('treats dhm_code or dhm_id as Sync', () => {
    expect(masterVesselDhmStatusLabel({ dhm_code: 'VSL-0001' })).toBe('Sync')
    expect(masterVesselDhmStatusLabel({ dhm_id: '11111111-1111-1111-1111-111111111111' })).toBe(
      'Sync',
    )
    expect(isMasterVesselDhmSynced({ dhm_code: 'VSL-0001' })).toBe(true)
    expect(masterVesselDhmStatusLabel({ code_dhm: 'CMD-0001' })).toBe('Sync')
  })

  it('treats empty replica fields as Not Sync', () => {
    expect(masterVesselDhmStatusLabel({})).toBe('Not Sync')
    expect(masterVesselDhmStatusLabel({ dhm_code: '  ', dhm_id: null })).toBe('Not Sync')
  })

  it('an undelivered push wins over the link: a row that was linked once is not "Sync" while its last edit is missing at DHM', () => {
    expect(masterVesselDhmStatusLabel({ code_dhm: 'CMD-0001', dhm_push_status: 'FAILED' })).toBe('Sync Failed')
    expect(masterVesselDhmStatusLabel({ code_dhm: 'CMD-0001', dhm_push_status: 'CONFLICT' })).toBe('Conflict')
    // a row whose very first push failed has no link yet, and says why instead of just "Not Sync"
    expect(masterVesselDhmStatusLabel({ dhm_push_status: 'FAILED' })).toBe('Sync Failed')
  })

  it('reads the push status case-insensitively, and ignores an empty or unknown one', () => {
    expect(masterVesselDhmStatusLabel({ code_dhm: 'X', dhm_push_status: 'failed' })).toBe('Sync Failed')
    expect(masterVesselDhmStatusLabel({ code_dhm: 'X', dhm_push_status: null })).toBe('Sync')
    expect(masterVesselDhmStatusLabel({ code_dhm: 'X', dhm_push_status: '' })).toBe('Sync')
  })
})

describe('dhmStatusHint', () => {
  it('says why a push failed, which attempt it is, and when the next one comes', () => {
    const hint = dhmStatusHint({
      code_dhm: 'PLT-1',
      dhm_push_status: 'FAILED',
      dhm_push_error: 'Plant needs a DHM site. Sync Master Site first.',
      dhm_push_attempts: 3,
      dhm_push_next_attempt_at: '2026-10-05T10:30:00.000Z',
    })
    expect(hint).toContain('belum sampai ke DHM: Plant needs a DHM site. Sync Master Site first.')
    expect(hint).toContain('Percobaan ke-3')
    expect(hint).toContain('Dicoba lagi otomatis')
  })

  it('sends the person to Integrations when the automatic attempts are used up', () => {
    const hint = dhmStatusHint({ dhm_push_status: 'FAILED', dhm_push_error: 'DHM unavailable', dhm_push_attempts: 8, dhm_push_next_attempt_at: null })
    expect(hint).toContain('Integrations > DHM')
    expect(hint).not.toContain('Dicoba lagi otomatis')
  })

  it('explains a conflict as a decision for a person, not a retry', () => {
    const hint = dhmStatusHint({ dhm_push_status: 'CONFLICT' })
    expect(hint).toContain('pilih overwrite')
  })

  it('keeps the DHM code as the tooltip of a healthy row, and says nothing for an unlinked one', () => {
    expect(dhmStatusHint({ code_dhm: 'CMD-0006' })).toBe('DHM: CMD-0006')
    expect(dhmStatusHint({ dhm_code: 'VSL-0001' })).toBe('DHM: VSL-0001')
    expect(dhmStatusHint({})).toBe('')
  })
})
