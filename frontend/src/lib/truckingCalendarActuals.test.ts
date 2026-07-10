import { describe, expect, it, vi } from 'vitest'
import {
  applyHPlusOnePlanningPromotions,
  getHPlusOneIsoDate,
  resolveCalendarCellQtyKg,
  shouldAutoPromoteHPlusOnePlanning,
  toLocalIsoDate,
} from './truckingCalendarActuals'

describe('truckingCalendarActuals', () => {
  const tomorrow = getHPlusOneIsoDate(new Date(2026, 5, 3)) // 2026-06-04

  it('computes H+1 as tomorrow local date', () => {
    expect(tomorrow).toBe('2026-06-04')
    expect(toLocalIsoDate(new Date(2026, 5, 3))).toBe('2026-06-03')
  })

  it('auto-promotes when planning exists on H+1 without actual', () => {
    const row = {
      id: 'op-1',
      delivery_start_date: '2026-06-01',
      delivery_end_date: '2026-06-30',
      daily_deliverables: [{ date: tomorrow, quantity_delivered: 25000 }],
      daily_actuals: [],
    }
    expect(shouldAutoPromoteHPlusOnePlanning(row, tomorrow)).toBe(true)
    expect(resolveCalendarCellQtyKg(row, tomorrow, tomorrow)).toBe(25000)
  })

  it('skips when actual already exists on H+1', () => {
    const row = {
      id: 'op-1',
      daily_deliverables: [{ date: tomorrow, quantity_delivered: 25000 }],
      daily_actuals: [{ date: tomorrow, quantity_delivered: 18000 }],
    }
    expect(shouldAutoPromoteHPlusOnePlanning(row, tomorrow)).toBe(false)
    expect(resolveCalendarCellQtyKg(row, tomorrow, tomorrow)).toBe(18000)
  })

  it('applyHPlusOnePlanningPromotions upserts eligible rows', async () => {
    const upsert = vi.fn(async () => [{ date: tomorrow, quantity_delivered: 25000 }])
    const rows = await applyHPlusOnePlanningPromotions(
      [
        {
          id: 'op-1',
          delivery_start_date: '2026-06-01',
          delivery_end_date: '2026-06-30',
          daily_deliverables: [{ date: tomorrow, quantity_delivered: 25000 }],
          daily_actuals: [],
        },
      ],
      upsert,
      tomorrow,
    )
    expect(upsert).toHaveBeenCalledWith('op-1', tomorrow, 25000)
    expect(rows[0].daily_actuals).toEqual([{ date: tomorrow, quantity_delivered: 25000 }])
  })
})
