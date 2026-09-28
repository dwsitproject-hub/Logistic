import { describe, expect, it } from 'vitest'
import { formatKg, sortGroups, type ClaimSusutAgingGroupRow } from './ClaimSusutSection1Dashboard'

const row = (group: string, total: number): ClaimSusutAgingGroupRow => ({
  group_of_transport: group,
  qty_claim: 0,
  a_0_30: 0,
  a_31_60: 0,
  a_61_90: 0,
  a_gt_90: total,
  grand_total: total,
})

describe('Claim Susut Section 1', () => {
  it('orders groups alphabetically like the PIVOT sheet, not by amount, with (Blank) last', () => {
    // The API returns groups by amount (VESSEL TC first on 31 Aug 2026); the sheet lists them A-Z.
    const sorted = sortGroups([
      row('VESSEL TC', 20_203_458_207),
      row('(Blank)', 1),
      row('VESSEL VOYAGE', 3_833_773_350),
      row('TRUCKING', 3_141_492_021),
      row('SURVEYOR', 1_159_717_028),
    ])
    expect(sorted.map((r) => r.group_of_transport)).toEqual([
      'SURVEYOR',
      'TRUCKING',
      'VESSEL TC',
      'VESSEL VOYAGE',
      '(Blank)',
    ])
  })

  it('shows realised quantities in kg, so a 100 kg claim is not rounded to "0 MT"', () => {
    expect(formatKg(100)).toBe('100')
    expect(formatKg(16_850)).toBe('16,850')
  })
})
