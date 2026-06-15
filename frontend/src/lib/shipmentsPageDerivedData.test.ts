import { describe, expect, it } from 'vitest'
import {
  computeEtaBuckets,
  computeSection1StatusCounts,
  filterRowsByStatusScope,
  filterRowsForTableDisplay,
  section1BadgeSum,
  type ShipmentsPageRow,
} from './shipmentsPageDerivedData'

const baseRow = (overrides: Partial<ShipmentsPageRow> = {}): ShipmentsPageRow => ({
  id: '1',
  shipment_id: 'SHP-1',
  sto_number: 'STO-1',
  status: 'PLANNED',
  ...overrides,
})

describe('computeSection1StatusCounts', () => {
  it('partitions all rows and folds UNPLANNED into planned badge', () => {
    const rows = [
      baseRow({ id: '1', status: 'PLANNED' }),
      baseRow({ id: '2', status: 'UNPLANNED', sto_number: 'STO-2' }),
      baseRow({ id: '3', status: 'IN_TRANSIT', sto_number: 'STO-3' }),
    ]
    const counts = computeSection1StatusCounts(rows)
    expect(counts.total).toBe(3)
    expect(counts.planned).toBe(2)
    expect(counts.inTransit).toBe(1)
    expect(section1BadgeSum(counts)).toBe(counts.total)
  })
})

describe('computeEtaBuckets contextual phases', () => {
  const fixedNow = new Date(2026, 5, 3)

  it('loading delay ignores in-transit shipments', () => {
    const rows = [
      baseRow({
        id: '1',
        status: 'PLANNED',
        eta_arrival: '2026-06-01',
      }),
      baseRow({
        id: '2',
        status: 'IN_TRANSIT',
        sto_number: 'STO-2',
        eta_arrival: '2026-06-01',
      }),
    ]
    const buckets = computeEtaBuckets(rows, 'loading', { now: fixedNow })
    expect(buckets.counts.delay).toBe(1)
  })

  it('discharge delay only counts in-transit, arrived, or unloading', () => {
    const rows = [
      baseRow({
        id: '1',
        status: 'PLANNED',
        eta_discharge_arrival: '2026-06-01',
      }),
      baseRow({
        id: '2',
        status: 'IN_TRANSIT',
        sto_number: 'STO-2',
        eta_discharge_arrival: '2026-06-01',
      }),
    ]
    const buckets = computeEtaBuckets(rows, 'discharge', { now: fixedNow })
    expect(buckets.counts.delay).toBe(1)
  })
})

describe('filterRowsByStatusScope', () => {
  it('narrows section 2 scope when a status card is active', () => {
    const rows = [
      baseRow({ id: '1', status: 'IN_TRANSIT', sto_number: 'STO-1' }),
      baseRow({ id: '2', status: 'PLANNED', sto_number: 'STO-2' }),
    ]
    const scoped = filterRowsByStatusScope(rows, 'IN_TRANSIT')
    expect(scoped).toHaveLength(1)
    expect(scoped[0].id).toBe('1')
  })
})

describe('filterRowsForTableDisplay', () => {
  const fixedNow = new Date(2026, 5, 3)

  it('applies ETA loading filter against shared bucket maps', () => {
    const rows = [
      baseRow({
        id: '1',
        status: 'PLANNED',
        eta_arrival: '2026-06-01',
      }),
      baseRow({
        id: '2',
        status: 'PLANNED',
        sto_number: 'STO-2',
        eta_arrival: '2026-06-10',
      }),
    ]
    const loading = computeEtaBuckets(rows, 'loading', { now: fixedNow })
    const discharge = computeEtaBuckets(rows, 'discharge', { now: fixedNow })
    const filtered = filterRowsForTableDisplay(
      rows,
      { statusFilter: 'ALL', etaLoadingFilter: 'DELAY', etaDischargeFilter: 'ALL' },
      { loading, discharge },
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('1')
  })
})
