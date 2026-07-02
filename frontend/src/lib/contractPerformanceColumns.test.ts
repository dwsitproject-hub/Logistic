import { describe, expect, it } from 'vitest'
import {
  CONTRACT_PERF_COLUMN_ORDER,
  buildContractPerfColumnWidthTracks,
  buildContractPerfVisibleColumns,
  contractPerfCompactColumnFallbackOrder,
  contractPerfTableColumnWidthPx,
  isContractPerformancePathname,
  mergeContractPerfColumnOrder,
  orderContractPerformanceColumns,
} from './contractPerformanceColumns'

describe('contractPerformanceColumns', () => {
  it('places primary columns first and appends extras', () => {
    const allIds = ['created_at', 'contract_date', 'supplier', 'vessel_name', 'contract_qty']
    expect(contractPerfCompactColumnFallbackOrder(allIds)).toEqual([
      'contract_date',
      'supplier',
      'contract_qty',
      'created_at',
      'vessel_name',
    ])
  })

  it('reorders column objects without changing ids', () => {
    const cols = [
      { id: 'product', label: 'Product' },
      { id: 'contract_date', label: 'Contract Date' },
      { id: 'supplier', label: 'Supplier' },
    ]
    const ordered = orderContractPerformanceColumns(cols)
    expect(ordered.map((c) => c.id)).toEqual(['contract_date', 'supplier', 'product'])
  })

  it('keeps CONTRACT_PERF_COLUMN_ORDER length', () => {
    expect(CONTRACT_PERF_COLUMN_ORDER.length).toBe(14)
  })

  it('uses compact fixed widths for default visible columns', () => {
    const tracks = buildContractPerfColumnWidthTracks(CONTRACT_PERF_COLUMN_ORDER)
    expect(tracks.contract_date).toBe('minmax(88px, 88px)')
    expect(tracks.supplier).toBe('minmax(112px, 112px)')
    const total = CONTRACT_PERF_COLUMN_ORDER.reduce((s, id) => s + contractPerfTableColumnWidthPx(id), 0)
    expect(total).toBeLessThan(1700)
  })

  it('isContractPerformancePathname accepts optional trailing slash', () => {
    expect(isContractPerformancePathname('/contract-performance')).toBe(true)
    expect(isContractPerformancePathname('/contract-performance/')).toBe(true)
    expect(isContractPerformancePathname('/contracts')).toBe(false)
  })

  it('buildContractPerfVisibleColumns follows saved column order', () => {
    const cols = [
      { id: 'product', label: 'Product' },
      { id: 'contract_date', label: 'Contract Date' },
      { id: 'supplier', label: 'Supplier' },
    ]
    const visible = new Set(['product', 'contract_date', 'supplier'])
    expect(
      buildContractPerfVisibleColumns(cols, visible, ['product', 'supplier', 'contract_date']).map(
        (c) => c.id,
      ),
    ).toEqual(['product', 'supplier', 'contract_date'])
    expect(buildContractPerfVisibleColumns(cols, visible).map((c) => c.id)).toEqual([
      'contract_date',
      'supplier',
      'product',
    ])
  })

  it('mergeContractPerfColumnOrder preserves saved sequence and appends new columns', () => {
    const allIds = [
      'contract_id',
      'contract_date',
      'supplier',
      'product',
      'vessel_name',
      'contract_qty',
    ]
    const saved = ['product', 'contract_date', 'contract_id', 'vessel_name', 'supplier', 'contract_qty']
    expect(mergeContractPerfColumnOrder(saved, allIds)).toEqual([
      'product',
      'contract_date',
      'contract_id',
      'vessel_name',
      'supplier',
      'contract_qty',
    ])
    expect(mergeContractPerfColumnOrder(['supplier', 'contract_date'], allIds)[0]).toBe('supplier')
  })
})
