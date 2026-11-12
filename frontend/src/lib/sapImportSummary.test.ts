import { describe, expect, it } from 'vitest'
import {
  displaySapImportFileName,
  filterSapImports,
  formatSapImportWhen,
  sapImportBarSegments,
  sapImportStatusMeta,
  sapImportSuccessRate,
  summarizeSapImports,
  type SapImportRow,
} from './sapImportSummary'

const row = (over: Partial<SapImportRow>): SapImportRow => ({
  id: 'x',
  import_timestamp: '2026-11-12T06:00:00',
  status: 'completed',
  total_records: 100,
  processed_records: 100,
  failed_records: 0,
  ...over,
})

describe('summarizeSapImports', () => {
  it('weights the success rate by rows, so a big clean file outweighs a small bad one', () => {
    const s = summarizeSapImports([
      row({ id: 'a', total_records: 10000, processed_records: 10000 }),
      row({ id: 'b', import_timestamp: '2026-11-11T06:00:00', total_records: 100, processed_records: 50, failed_records: 50, status: 'completed_with_errors' }),
    ])
    expect(s.weightedSuccessRate).toBeCloseTo((10050 / 10100) * 100, 5)
    expect(s.finishedCount).toBe(2)
  })

  it('leaves out imports still running and cancelled ones', () => {
    const s = summarizeSapImports([
      row({ id: 'a', status: 'processing', total_records: 1000, processed_records: 10 }),
      row({ id: 'b', import_timestamp: '2026-11-11T06:00:00', status: 'cancelled', total_records: 500, processed_records: 0 }),
      row({ id: 'c', import_timestamp: '2026-11-10T06:00:00', total_records: 200, processed_records: 200 }),
    ])
    expect(s.weightedSuccessRate).toBe(100)
    expect(s.finishedCount).toBe(1)
  })

  it('takes the newest import as the latest, whatever order the list came in', () => {
    const s = summarizeSapImports([
      row({ id: 'old', import_timestamp: '2026-11-01T06:00:00' }),
      row({ id: 'new', import_timestamp: '2026-11-12T06:00:00' }),
    ])
    expect(s.latest?.id).toBe('new')
  })

  it('sums failed rows over the newest seven only', () => {
    const list = Array.from({ length: 9 }, (_, i) =>
      row({ id: String(i), import_timestamp: `2026-11-${String(20 - i).padStart(2, '0')}T06:00:00`, failed_records: i === 8 ? 999 : 1 }),
    )
    const s = summarizeSapImports(list)
    expect(s.recentCount).toBe(7)
    expect(s.recentFailedRows).toBe(7)
  })

  it('has nothing to say about an empty list', () => {
    const s = summarizeSapImports([])
    expect(s.latest).toBeNull()
    expect(s.weightedSuccessRate).toBeNull()
  })
})

describe('row helpers', () => {
  it('names a status and keeps an unknown one readable', () => {
    expect(sapImportStatusMeta('completed_with_errors')).toEqual({ label: 'With errors', tone: 'warning' })
    expect(sapImportStatusMeta('weird').label).toBe('weird')
  })

  it('filters by status', () => {
    const list = [row({ status: 'completed' }), row({ status: 'failed' }), row({ status: 'completed_with_errors' })]
    expect(filterSapImports(list, 'all')).toHaveLength(3)
    expect(filterSapImports(list, 'failed')).toHaveLength(1)
    expect(filterSapImports(list, 'with_errors')[0].status).toBe('completed_with_errors')
  })

  it('rates a file with no rows as unknown, not 0%', () => {
    expect(sapImportSuccessRate({ total_records: 0, processed_records: 0 })).toBeNull()
    expect(sapImportSuccessRate({ total_records: 200, processed_records: 150 })).toBe(75)
  })

  it('keeps a small failure visible in the bar and never overflows it', () => {
    const a = sapImportBarSegments({ total_records: 10000, processed_records: 9999, failed_records: 1 })
    expect(a.failedPct).toBe(2)
    expect(a.okPct + a.failedPct).toBeLessThanOrEqual(100)
    expect(sapImportBarSegments({ total_records: 0, processed_records: 0, failed_records: 0 })).toEqual({ okPct: 0, failedPct: 0 })
  })

  it('writes today and yesterday in words and older dates in full', () => {
    const now = new Date(2026, 10, 12, 15, 0)
    expect(formatSapImportWhen(new Date(2026, 10, 12, 6, 2).toISOString(), now)).toEqual({ day: 'Today', time: '06:02' })
    expect(formatSapImportWhen(new Date(2026, 10, 11, 23, 40).toISOString(), now).day).toBe('Yesterday')
    expect(formatSapImportWhen(new Date(2026, 9, 3, 9, 5).toISOString(), now).day).toBe('3 Oct 2026')
  })

  it('shows a file name without its Excel extension', () => {
    expect(displaySapImportFileName('CPO 3 Sep 2026.xlsx')).toBe('CPO 3 Sep 2026')
    expect(displaySapImportFileName(null)).toBe('—')
  })
})
