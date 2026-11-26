import { describe, expect, it } from 'vitest'
import {
  filterWbImports,
  formatKgAsMt,
  formatWbUploadDay,
  summarizeWbImports,
  wbImportBarSegments,
  wbImportDurationSeconds,
  wbImportOperationRate,
  wbImportOutcome,
  wbImportStatusMeta,
  wbImportUploaderLabel,
  type WbImportRow,
} from './wbDataSummary'

const row = (over: Partial<WbImportRow> = {}): WbImportRow => ({
  id: 'x',
  file_name: 'Rekap AGUSTUS 2026.xlsx',
  status: 'completed',
  created_at: '2026-08-11T04:30:56.353Z',
  updated_at: '2026-08-11T04:34:04.875Z',
  uploaded_by_name: 'Ryan Pohan',
  raw_ticket_rows: 1725,
  aggregated_po_dates: 239,
  operations_updated: 78,
  operations_failed: 0,
  rows_upserted: 239,
  ...over,
})

describe('wbImportOutcome', () => {
  it('reads the server status for partial and failed', () => {
    expect(wbImportOutcome(row({ status: 'partial', operations_failed: 5 }))).toBe('partial')
    expect(wbImportOutcome(row({ status: 'failed', rows_upserted: 0 }))).toBe('failed')
  })

  it('a completed upload that wrote rows is completed', () => {
    expect(wbImportOutcome(row())).toBe('completed')
  })

  it('a completed upload with PO/date lines that wrote nothing and failed nothing is not a clean success', () => {
    expect(wbImportOutcome(row({ rows_upserted: 0, operations_updated: 0, operations_failed: 0 }))).toBe('nothing_written')
    expect(wbImportStatusMeta(row({ rows_upserted: 0, operations_updated: 0 })).tone).toBe('warning')
  })

  it('a file with no ticket at all is "No tickets", neutral', () => {
    const empty = row({ raw_ticket_rows: 0, aggregated_po_dates: 0, rows_upserted: 0, operations_updated: 0 })
    expect(wbImportOutcome(empty)).toBe('empty')
    expect(wbImportStatusMeta(empty).tone).toBe('neutral')
  })
})

describe('filterWbImports', () => {
  const list = [
    row({ id: 'a' }),
    row({ id: 'b', status: 'partial', operations_failed: 3 }),
    row({ id: 'c', status: 'failed', rows_upserted: 0 }),
    row({ id: 'd', rows_upserted: 0, operations_updated: 0 }),
  ]
  it('keeps everything for All and splits the rest by outcome', () => {
    expect(filterWbImports(list, 'all')).toHaveLength(4)
    expect(filterWbImports(list, 'completed').map((r) => r.id)).toEqual(['a'])
    expect(filterWbImports(list, 'failed').map((r) => r.id)).toEqual(['c'])
    // "With issues" holds the partial one AND the one that wrote nothing
    expect(filterWbImports(list, 'with_issues').map((r) => r.id)).toEqual(['b', 'd'])
  })
})

describe('wbImportUploaderLabel', () => {
  it('prefers the full name, then the username, then Unknown', () => {
    expect(wbImportUploaderLabel({ uploaded_by_name: 'Ryan Pohan', uploaded_by_username: 'ryan' })).toBe('Ryan Pohan')
    expect(wbImportUploaderLabel({ uploaded_by_name: ' ', uploaded_by_username: 'ryan' })).toBe('ryan')
    expect(wbImportUploaderLabel({ uploaded_by_name: null, uploaded_by_username: null })).toBe('Unknown')
  })
})

describe('summarizeWbImports', () => {
  it('finds the newest upload, the recent failures, the weighted rate and the uploaders', () => {
    const imports = [
      row({ id: 'old', created_at: '2026-07-01T00:00:00Z', operations_updated: 10, operations_failed: 10, uploaded_by_name: 'Siti' }),
      row({ id: 'new', created_at: '2026-08-11T00:00:00Z', operations_updated: 80, operations_failed: 0 }),
    ]
    const s = summarizeWbImports(imports)
    expect(s.latest?.id).toBe('new')
    expect(s.recentFailedOperations).toBe(10)
    expect(s.recentCount).toBe(2)
    expect(s.weightedOperationRate).toBeCloseTo(90, 5)
    expect(s.uploaderCount).toBe(2)
  })

  it('has no rate when no upload had an operation, and ignores Unknown uploaders in the count', () => {
    const s = summarizeWbImports([row({ operations_updated: 0, operations_failed: 0, uploaded_by_name: null, uploaded_by_username: null })])
    expect(s.weightedOperationRate).toBeNull()
    expect(s.uploaderCount).toBe(0)
    expect(summarizeWbImports([]).latest).toBeNull()
  })
})

describe('bars, duration and weights', () => {
  it('keeps a failed sliver visible and the two segments within 100%', () => {
    const { okPct, failedPct } = wbImportBarSegments({ operations_updated: 999, operations_failed: 1 })
    expect(failedPct).toBe(2)
    expect(okPct + failedPct).toBeLessThanOrEqual(100)
    expect(wbImportBarSegments({ operations_updated: 0, operations_failed: 0 })).toEqual({ okPct: 0, failedPct: 0 })
  })

  it('rates the operations of one upload, null when it had none', () => {
    expect(wbImportOperationRate({ operations_updated: 78, operations_failed: 5 })).toBeCloseTo(93.97, 1)
    expect(wbImportOperationRate({ operations_updated: 0, operations_failed: 0 })).toBeNull()
  })

  it('measures how long an upload took, null when the times are missing or out of order', () => {
    expect(wbImportDurationSeconds(row())).toBeCloseTo(188.522, 2)
    expect(wbImportDurationSeconds(row({ updated_at: null }))).toBeNull()
    expect(wbImportDurationSeconds(row({ updated_at: '2026-01-01T00:00:00Z' }))).toBeNull()
  })

  it('names the upload day in the zone of its time, not the UTC date of the ISO string', () => {
    // 02:00:24 LOCAL on the 12th: whatever the zone of the machine, the day is the 12th (the UTC date of this instant can be the 11th)
    const local = new Date(2026, 7, 12, 2, 0, 24)
    expect(formatWbUploadDay(local.toISOString())).toBe('12/08/2026')
    expect(formatWbUploadDay(null)).toBe('-')
    expect(formatWbUploadDay('not a date')).toBe('-')
  })

  it('writes kilograms as MT', () => {
    expect(formatKgAsMt(1234500)).toBe('1,234.5 MT')
    expect(formatKgAsMt('25000.00')).toBe('25 MT')
    expect(formatKgAsMt(null)).toBe('—')
    expect(formatKgAsMt('x')).toBe('—')
  })
})
