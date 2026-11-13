import { describe, expect, it } from 'vitest'
import {
  daysSinceIsoDate,
  detectClaimDataKind,
  formatFileSize,
  isClaimDataFileName,
  summarizeClaimStatus,
  type ClaimStatusData,
} from './claimDataImportView'

describe('detectClaimDataKind', () => {
  it('reads the kind from the SAP file name, whatever the spaces, underscores and case', () => {
    expect(detectClaimDataKind('OSCLAIM_ALLREGION_MUTU SUSUT_JAN S.D OKT 2026.xls')).toBe('os')
    expect(detectClaimDataKind('REALCLAIM_ALLREGION_MUTU SUSUT_JAN S.D OKT 2026.xls')).toBe('real')
    expect(detectClaimDataKind('os claim oktober.xlsx')).toBe('os')
    expect(detectClaimDataKind('real_claim.xls')).toBe('real')
  })

  it('leaves the choice to the person when the name says nothing', () => {
    expect(detectClaimDataKind('claims.xls')).toBeNull()
    expect(detectClaimDataKind('')).toBeNull()
  })
})

describe('files', () => {
  it('accepts .xls and .xlsx only', () => {
    expect(isClaimDataFileName('a.XLS')).toBe(true)
    expect(isClaimDataFileName('a.xlsx')).toBe(true)
    expect(isClaimDataFileName('a.csv')).toBe(false)
    expect(isClaimDataFileName('a.xlsm')).toBe(false)
  })

  it('writes a size in the unit people read', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(9321031)).toBe('8.9 MB')
    expect(formatFileSize(-1)).toBe('-')
  })
})

describe('summarizeClaimStatus', () => {
  const now = new Date(2026, 10, 13, 10, 0)
  const status: ClaimStatusData = {
    latest: {
      os: { file_name: 'OSCLAIM.xls', data_as_of: '2026-11-10', uploaded_at: '2026-11-11T09:00:00', total_rows: 591 },
      real: { file_name: 'REALCLAIM.xls', data_as_of: null, uploaded_at: '2026-11-12T09:00:00', total_rows: 300 },
    },
    counts: { os_susut: 200, os_mutu: 100, real_susut: 40, real_mutu: 10 },
  }

  it('totals each kind and names the newest import', () => {
    const s = summarizeClaimStatus(status, now)
    expect(s.os).toEqual({ imported: true, shortage: 200, quality: 100, total: 300 })
    expect(s.real.total).toBe(50)
    expect(s.lastImport).toEqual({ kind: 'real', fileName: 'REALCLAIM.xls', uploadedAt: '2026-11-12T09:00:00' })
  })

  it('takes "data as of" from the outstanding import and counts the days', () => {
    const s = summarizeClaimStatus(status, now)
    expect(s.dataAsOf).toBe('2026-11-10')
    expect(s.dataAsOfDaysAgo).toBe(3)
  })

  it('says nothing is imported when nothing is', () => {
    const s = summarizeClaimStatus(null, now)
    expect(s.lastImport).toBeNull()
    expect(s.os.imported).toBe(false)
    expect(s.dataAsOf).toBeNull()
  })

  it('counts calendar days, and a date in the future reads 0', () => {
    expect(daysSinceIsoDate('2026-11-13', now)).toBe(0)
    expect(daysSinceIsoDate('2026-11-20', now)).toBe(0)
    expect(daysSinceIsoDate('nonsense', now)).toBeNull()
  })
})

describe('filterClaimUploads', () => {
  const items = [
    { kind: 'os' as const, failed_rows: 0 },
    { kind: 'real' as const, failed_rows: 3 },
    { kind: 'os' as const, failed_rows: 2 },
  ]
  it('filters by kind and by failed rows', async () => {
    const { filterClaimUploads } = await import('./claimDataImportView')
    expect(filterClaimUploads(items, 'all')).toHaveLength(3)
    expect(filterClaimUploads(items, 'os')).toHaveLength(2)
    expect(filterClaimUploads(items, 'real')).toHaveLength(1)
    expect(filterClaimUploads(items, 'failed')).toHaveLength(2)
  })
})
