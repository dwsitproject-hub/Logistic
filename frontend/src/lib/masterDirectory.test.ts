import { describe, expect, it } from 'vitest'
import { masterCountText, masterDhmChip, masterInitials, sortCompanyOptions } from './masterDirectory'

describe('masterDhmChip', () => {
  it('reads a linked row as Synced and an unlinked one as Not synced', () => {
    expect(masterDhmChip({ dhm_id: 'abc' })).toMatchObject({ label: 'Synced', tone: 'ok', filter: 'synced' })
    expect(masterDhmChip({ code_dhm: 'SITE-0001' })).toMatchObject({ label: 'Synced', filter: 'synced' })
    expect(masterDhmChip({})).toMatchObject({ label: 'Not synced', tone: 'idle', filter: 'not_synced' })
    expect(masterDhmChip({ dhm_id: '  ', code_dhm: '' })).toMatchObject({ filter: 'not_synced' })
  })
  it('lets an undelivered push win over the link, and counts a conflict as failed', () => {
    expect(masterDhmChip({ dhm_id: 'abc', dhm_push_status: 'FAILED' })).toMatchObject({ label: 'Failed', tone: 'bad', filter: 'failed' })
    expect(masterDhmChip({ dhm_id: 'abc', dhm_push_status: 'conflict' })).toMatchObject({ label: 'Conflict', tone: 'warn', filter: 'failed' })
  })
})

describe('masterInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(masterInitials('JAKARTA TERMINAL')).toBe('JT')
    expect(masterInitials('Tanjung Pura Port')).toBe('TP')
    expect(masterInitials('kuala-tanjung')).toBe('KT')
  })
  it('takes two letters of a single word, and skips symbols', () => {
    expect(masterInitials('BEKASI')).toBe('BE')
    expect(masterInitials('X')).toBe('X')
    expect(masterInitials('(PT) KPBN')).toBe('PK')
  })
  it('is a question mark for nothing', () => {
    expect(masterInitials('')).toBe('?')
    expect(masterInitials(null)).toBe('?')
    expect(masterInitials('--')).toBe('?')
  })
})

describe('sortCompanyOptions', () => {
  it('sorts A-Z ignoring PT, without changing the input', () => {
    const input = [
      { id: '1', name: 'PT. SEMESTA BUANA' },
      { id: '2', name: 'PT. AGRO HILIR' },
      { id: '3', name: 'KPBN' },
    ]
    expect(sortCompanyOptions(input).map((o) => o.id)).toEqual(['2', '3', '1'])
    expect(input.map((o) => o.id)).toEqual(['1', '2', '3'])
  })
})

describe('masterCountText', () => {
  it('says "of N" when nothing is filtered and names both numbers when it is', () => {
    expect(masterCountText(20, 60, 60, 'sites')).toBe('Showing 20 of 60 sites')
    expect(masterCountText(14, 14, 1234, 'sites')).toBe('Showing 14 of 14 matching sites (1,234 in total)')
  })
})
