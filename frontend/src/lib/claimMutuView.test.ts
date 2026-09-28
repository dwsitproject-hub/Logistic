import { describe, expect, it } from 'vitest'
import {
  appendClaimMutuFilterParams,
  CLAIM_MUTU_DEFAULT_B2B,
  formatClaimMutuCompact,
  formatClaimMutuMonth,
  pairValue,
  formatShare,
  groupByCommodity,
  trendUnits,
  type ClaimMutuCommodityUnitRow,
} from './claimMutuView'
import { sortLocations } from '@/components/claim-mutu/ClaimMutuSection1Dashboard'

const cu = (commodity: string, unit: string, os_amount: number, real_amount = 0): ClaimMutuCommodityUnitRow => ({
  commodity,
  unit,
  os_qty: os_amount / 1000,
  os_amount,
  real_qty: real_amount / 1000,
  real_amount,
})

describe('Claim Mutu view', () => {
  it('opens on Exclude B2B, and always sends the scope so the backend never guesses', () => {
    expect(CLAIM_MUTU_DEFAULT_B2B).toBe('exclude')
    const p = appendClaimMutuFilterParams(new URLSearchParams(), { b2b: 'exclude' })
    expect(p.get('b2b')).toBe('exclude')
    const inc = appendClaimMutuFilterParams(new URLSearchParams(), {
      b2b: 'include',
      importId: 'x',
      commodities: ['CPO', 'PK'],
      claimGroups: ['INTERCO (INHOUSE)'],
    })
    expect(inc.get('b2b')).toBe('include')
    expect(inc.getAll('commodities')).toEqual(['CPO', 'PK'])
    expect(inc.getAll('claimGroups')).toEqual(['INTERCO (INHOUSE)'])
  })

  it('the trend request carries no import, since it spans every monthly import', () => {
    const p = appendClaimMutuFilterParams(new URLSearchParams(), { b2b: 'exclude', importId: 'x' }, { omitImport: true })
    expect(p.has('importId')).toBe(false)
  })

  it('orders Summary Per Komoditi like the sheet, with sub totals and zero cells dropped', () => {
    const { groups, total } = groupByCommodity([
      cu('WASTE OIL (POME)', 'JAMBI', 5),
      cu('PK', 'TANJUNG PURA', 3),
      cu('CPO', 'KARAWANG', 2),
      cu('CPO', 'BONTANG', 10, 4),
      cu('CPKO', 'KARAWANG', 0, 7),
      cu('RPO', 'TANGERANG', 0, 0),
    ])
    expect(groups.map((g) => g.commodity)).toEqual(['CPO', 'CPKO', 'PK', 'WASTE OIL (POME)'])
    // Within CPO, units follow the sheet's unit order: BONTANG before KARAWANG.
    expect(groups[0].units.map((u) => u.unit)).toEqual(['BONTANG', 'KARAWANG'])
    expect(groups[0].subtotal.os_amount).toBe(12)
    expect(groups[0].subtotal.real_amount).toBe(4)
    expect(total.os_amount).toBe(20)
    expect(total.real_amount).toBe(11)
  })

  it('Summary Per Unit shows only units with a value, in the sheet order', () => {
    expect(
      trendUnits([
        { month: '2026-08-01', unit: 'JAMBI', os_qty: 1, os_amount: 1, real_qty: 0, real_amount: 0 },
        { month: '2026-08-01', unit: 'RIAU', os_qty: 0, os_amount: 0, real_qty: 0, real_amount: 0 },
        { month: '2026-07-01', unit: 'BONTANG', os_qty: 0, os_amount: 0, real_qty: 0, real_amount: 9 },
      ]),
    ).toEqual(['BONTANG', 'JAMBI'])
  })

  it('Rekap Per Lokasi lists DEST codes A-Z, drops empty ones, (Blank) last', () => {
    const loc = (dest: string, os_amount: number) => ({ dest, unit: dest, os_qty: 0, os_amount, real_qty: 0, real_amount: 0 })
    expect(sortLocations([loc('TJM', 1), loc('(Blank)', 1), loc('BKS', 1), loc('KMI', 0)]).map((r) => r.dest)).toEqual([
      'BKS',
      'TJM',
      '(Blank)',
    ])
  })

  it('formats months and shares the way the workbook reads', () => {
    expect(formatClaimMutuMonth('2026-08-01')).toBe('August 2026')
    expect(formatShare(25, 100)).toBe('25%')
    expect(formatShare(1, 0)).toBe('-')
    expect(formatShare(2_224_129, 34_460_622_316)).toBe('<0.1%')
  })

  it('shortens Section 1 numbers to B / M, whole under a million', () => {
    expect(formatClaimMutuCompact(34_460_622_316.34)).toBe('34,46 B')
    expect(formatClaimMutuCompact(5_869_557_763)).toBe('5,87 B')
    expect(formatClaimMutuCompact(7_494_607)).toBe('7,49 M')
    expect(formatClaimMutuCompact(175.64)).toBe('176')
    expect(formatClaimMutuCompact(0)).toBe('-')
  })

  it('picks value or quantity from a side pair', () => {
    const p = { os_qty: 1, os_amount: 2, real_qty: 3, real_amount: 4 }
    expect([pairValue(p, 'os', 'amount'), pairValue(p, 'os', 'qty'), pairValue(p, 'real', 'amount'), pairValue(p, 'real', 'qty')]).toEqual([2, 1, 4, 3])
  })
})
