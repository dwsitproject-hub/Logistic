import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }))

import { codGroupsOfType, codVersionLabel, pickCodVersion, type CodFileGroup, type CodFileVersion } from './codFiles'

const v = (over: Partial<CodFileVersion>): CodFileVersion => ({
  id: 'x',
  version: 1,
  fileName: 'DO.pdf',
  sizeBytes: 10,
  mimeType: 'application/pdf',
  uploadedAt: '2026-11-20T07:02:00.000Z',
  uploadedBy: 'Sari W.',
  isLatest: false,
  ...over,
})

const group = (po: string, type: CodFileGroup['type'], ids: string[]): CodFileGroup => ({
  poNumber: po,
  type,
  versions: ids.map((id, i) => v({ id, version: ids.length - i, isLatest: i === 0 })),
})

describe('pickCodVersion', () => {
  it('opens on the latest, takes the picked version when it exists, and falls back to the latest when it does not (a reload removed it)', () => {
    const g = group('PO-A', 'delivery_order', ['new', 'mid', 'old'])
    expect(pickCodVersion(g, null)?.id).toBe('new')
    expect(pickCodVersion(g, 'old')?.id).toBe('old')
    expect(pickCodVersion(g, 'gone')?.id).toBe('new')
  })

  it('is null for a group with no version', () => {
    expect(pickCodVersion({ poNumber: 'PO-A', type: 'contract', versions: [] }, null)).toBeNull()
  })
})

describe('codVersionLabel', () => {
  it('names the version, the uploader and marks the latest; leaves out what is not known', () => {
    expect(codVersionLabel(v({ version: 3, isLatest: true }))).toMatch(/^Version 3 · .+ · Sari W\. \(latest\)$/)
    const older = codVersionLabel(v({ version: 2, uploadedBy: null, isLatest: false }))
    expect(older.startsWith('Version 2 · ')).toBe(true)
    expect(older).not.toContain('latest')
    expect(codVersionLabel(v({ version: 1, uploadedAt: null, uploadedBy: null }))).toBe('Version 1')
  })
})

describe('codGroupsOfType', () => {
  it('keeps the order of the PO keys, one type, and skips a PO that has none', () => {
    const groups = [group('PO-A', 'contract', ['a']), group('PO-B', 'delivery_order', ['b']), group('PO-C', 'contract', ['c'])]
    expect(codGroupsOfType(groups, 'contract', ['PO-C', 'PO-B', 'PO-A', 'PO-Z']).map((g) => g.poNumber)).toEqual(['PO-C', 'PO-A'])
    expect(codGroupsOfType(groups, 'delivery_order', ['PO-A', 'PO-B']).map((g) => g.poNumber)).toEqual(['PO-B'])
  })
})
