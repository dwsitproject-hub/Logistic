import { describe, expect, it } from 'vitest'
import { isMasterVesselDhmSynced, masterVesselDhmStatusLabel } from './masterVesselDhmStatus'

describe('masterVesselDhmStatus', () => {
  it('treats dhm_code or dhm_id as Sync', () => {
    expect(masterVesselDhmStatusLabel({ dhm_code: 'VSL-0001' })).toBe('Sync')
    expect(masterVesselDhmStatusLabel({ dhm_id: '11111111-1111-1111-1111-111111111111' })).toBe(
      'Sync',
    )
    expect(isMasterVesselDhmSynced({ dhm_code: 'VSL-0001' })).toBe(true)
  })

  it('treats empty replica fields as Not Sync', () => {
    expect(masterVesselDhmStatusLabel({})).toBe('Not Sync')
    expect(masterVesselDhmStatusLabel({ dhm_code: '  ', dhm_id: null })).toBe('Not Sync')
  })
})
