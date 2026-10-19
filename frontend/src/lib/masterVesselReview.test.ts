import { describe, expect, it } from 'vitest'
import { describeVesselKind, describeVesselReviewReason, VESSEL_REVIEW_REASON_LABELS } from './masterVesselReview'

describe('masterVesselReview', () => {
  it('words every reason the backend can write', () => {
    // the flags of backend/src/utils/sapVesselNameParse.ts (VesselNameFlag, minus "empty") and the two the registration adds
    const written = [
      'truncated',
      'no_prefix',
      'unknown_prefix',
      'tug_inferred',
      'barge_inferred',
      'prefix_undecided',
      'pair_roles_conflict',
      'too_many_segments',
      'code_held_by_other',
      'code_ambiguous',
    ]
    for (const code of written) expect(VESSEL_REVIEW_REASON_LABELS[code], code).toBeTruthy()
  })

  it('shows an unknown reason as it is rather than hiding it', () => {
    expect(describeVesselReviewReason('something_new')).toBe('something_new')
    expect(describeVesselReviewReason('truncated')).toMatch(/terpotong/)
  })

  it('says what a vessel is from its type and role, and "-" when nothing is known', () => {
    expect(describeVesselKind({ vessel_type: 'BARGE', vessel_role: 'BG' })).toBe('BARGE · BG')
    expect(describeVesselKind({ vessel_type: null, vessel_role: 'TB' })).toBe('TB')
    expect(describeVesselKind({ vessel_type: null, vessel_role: null })).toBe('-')
  })
})
