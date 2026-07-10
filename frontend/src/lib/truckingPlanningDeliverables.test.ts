import { describe, expect, it } from 'vitest'
import {
  buildDailyDeliverablesFromPerDayPlanning,
  derivePerDayMtFromDailyDeliverables,
  getPlanningExceedsOutstandingError,
  sumDailyDeliverablesKg,
} from './truckingPlanningDeliverables'

describe('buildDailyDeliverablesFromPerDayPlanning', () => {
  it('distributes per-day MT evenly when within outstanding', () => {
    const rows = buildDailyDeliverablesFromPerDayPlanning('2026-01-01', '2026-01-03', 100, 500_000)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.quantity_delivered)).toEqual([100_000, 100_000, 100_000])
  })

  it('caps last day when per-day total exceeds outstanding (900 MT / 5 days @ 200 MT/day)', () => {
    const rows = buildDailyDeliverablesFromPerDayPlanning('2026-01-01', '2026-01-05', 200, 900_000)
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.quantity_delivered)).toEqual([200_000, 200_000, 200_000, 200_000, 100_000])
    expect(sumDailyDeliverablesKg(rows)).toBe(900_000)
  })

  it('stops allocating when outstanding is exhausted before last day', () => {
    const rows = buildDailyDeliverablesFromPerDayPlanning('2026-01-01', '2026-01-05', 200, 500_000)
    expect(rows.map((r) => r.quantity_delivered)).toEqual([200_000, 200_000, 100_000, 0, 0])
    expect(sumDailyDeliverablesKg(rows)).toBe(500_000)
  })
})

describe('derivePerDayMtFromDailyDeliverables', () => {
  it('uses first day quantity as per-day rate', () => {
    const perDay = derivePerDayMtFromDailyDeliverables(
      [
        { date: '2026-01-01', quantity_delivered: 200_000 },
        { date: '2026-01-02', quantity_delivered: 200_000 },
        { date: '2026-01-03', quantity_delivered: 100_000 },
      ],
      '2026-01-01',
      '2026-01-03',
    )
    expect(perDay).toBe(200)
  })
})

describe('getPlanningExceedsOutstandingError', () => {
  it('returns null when total is within outstanding', () => {
    expect(
      getPlanningExceedsOutstandingError({
        perDayMt: 100,
        startIso: '2026-01-01',
        endIso: '2026-01-03',
        outstandingKg: 500_000,
      }),
    ).toBeNull()
  })

  it('returns message when per-day total exceeds outstanding', () => {
    const msg = getPlanningExceedsOutstandingError({
      perDayMt: 200,
      startIso: '2026-01-01',
      endIso: '2026-01-05',
      outstandingKg: 900_000,
      formatMt: (n) => n.toFixed(2),
    })
    expect(msg).toContain('exceeds Outstanding Qty')
    expect(msg).toContain('1000.00 MT over 5 days')
    expect(msg).toContain('900.00 MT')
  })
})
