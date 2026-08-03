import { describe, expect, it } from 'vitest'
import {
  buildCargoReadinessChangeRemark,
  cargoReadinessDatesEqual,
} from './contractCargoReadinessRemark'

describe('contractCargoReadinessRemark', () => {
  it('buildCargoReadinessChangeRemark formats audit line and user remark', () => {
    expect(
      buildCargoReadinessChangeRemark('2026-07-01', '2026-07-05', 'Supplier confirmed delay'),
    ).toBe('Cargo Readiness Date: 01/07/2026 → 05/07/2026\nSupplier confirmed delay')
  })

  it('buildCargoReadinessChangeRemark throws when remark empty', () => {
    expect(() => buildCargoReadinessChangeRemark('2026-07-01', '2026-07-05', '   ')).toThrow(
      'Remark is required',
    )
  })

  it('cargoReadinessDatesEqual compares YYYY-MM-DD prefix', () => {
    expect(cargoReadinessDatesEqual('2026-07-01T00:00:00.000Z', '2026-07-01')).toBe(true)
    expect(cargoReadinessDatesEqual('2026-07-01', '2026-07-02')).toBe(false)
    expect(cargoReadinessDatesEqual(null, '')).toBe(true)
  })
})
