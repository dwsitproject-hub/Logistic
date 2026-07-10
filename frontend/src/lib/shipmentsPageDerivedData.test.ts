import { describe, expect, it } from 'vitest'
import {
  computeEtaBuckets,
  computeSection1StatusCounts,
  fetchShipmentsCatalogBatches,
  filterRowsByStatusScope,
  filterRowsForTableDisplay,
  section1BadgeSum,
  section1CountForStatus,
  SHIPMENTS_CATALOG_PAGE_SIZE,
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
  it('partitions all rows with separate unplanned and planned badges', () => {
    const rows = [
      baseRow({ id: '1', status: 'PLANNED' }),
      baseRow({ id: '2', status: 'UNPLANNED', sto_number: 'STO-2' }),
      baseRow({ id: '3', status: 'SAILED', sto_number: 'STO-3' }),
    ]
    const counts = computeSection1StatusCounts(rows)
    expect(counts.total).toBe(3)
    expect(counts.unplanned).toBe(1)
    expect(counts.planned).toBe(1)
    expect(counts.sailed).toBe(1)
    expect(section1BadgeSum(counts)).toBe(counts.total)
  })
})

describe('section1CountForStatus', () => {
  it('returns distribution count for each pipeline status card', () => {
    const counts = {
      unplanned: 7,
      planned: 32,
      atLoadingPort: 5,
      sailed: 8,
      atDischargePort: 3,
      completed: 83,
      cancelled: 0,
      total: 134,
    }
    expect(section1CountForStatus('PLANNED', counts)).toBe(32)
    expect(section1CountForStatus('AT_LOADING_PORT', counts)).toBe(5)
    expect(section1CountForStatus('ALL', counts)).toBe(0)
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
        status: 'SAILED',
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
        status: 'SAILED',
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
    const scoped = filterRowsByStatusScope(rows, 'SAILED')
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

describe('fetchShipmentsCatalogBatches', () => {
  it('merges paginated API responses into one catalog', async () => {
    const scope = new URLSearchParams({ compact: 'true', includeSummary: 'false', skipSapJoin: 'true' })
    const pageSize = SHIPMENTS_CATALOG_PAGE_SIZE
    const get = async (url: string) => {
      const params = new URLSearchParams(url.split('?')[1] ?? '')
      const page = Number(params.get('page') || 1)
      const limit = Number(params.get('limit') || pageSize)
      if (page === 1) {
        return {
          data: {
            success: true,
            data: {
              shipments: Array.from({ length: limit }, (_, i) => ({ id: `p1-${i}` })),
              pagination: { total: limit + 2 },
            },
          },
        }
      }
      return {
        data: {
          success: true,
          data: {
            shipments: [{ id: 'p2-0' }, { id: 'p2-1' }],
            pagination: { total: limit + 2 },
          },
        },
      }
    }

    const rows = await fetchShipmentsCatalogBatches<{ id: string }>(get, scope)
    expect(rows).toHaveLength(pageSize + 2)
    expect(rows[0].id).toBe('p1-0')
    expect(rows[rows.length - 1].id).toBe('p2-1')
  })
})
