import { describe, expect, it } from 'vitest'
import { resolveKlipSapProvenance } from './klipSapCompare'
import { isKlipEditedField } from './klipProvenance'
import { kgToMt, sapFigureView } from './sapFigure'

/** The badge exactly as KlipSapCompareField derives it for these two fields. */
function badge(klipKg: number | null, sapKg: number | null, markers: string[], column = 'sfal_qty') {
  const view = sapFigureView(klipKg, sapKg)
  return {
    view,
    provenance: resolveKlipSapProvenance({
      klipValue: view.klipMt,
      sapValue: view.sapMt,
      format: 'number',
      klipEdited: isKlipEditedField(markers, column),
      zeroIsEmpty: true,
    }),
  }
}

describe('SFAL / SFBD in kg become MT', () => {
  it('converts, and leaves a missing figure missing', () => {
    expect(kgToMt(497100)).toBe(497.1)
    expect(kgToMt(null)).toBeNull()
    expect(kgToMt(undefined)).toBeNull()
    expect(kgToMt(Number.NaN)).toBeNull()
  })

  it('SAP zero is no figure: the template sends 0.000 where it has none', () => {
    expect(sapFigureView(null, 0).sapMt).toBeNull()
    expect(sapFigureView(null, 0).referenceOnly).toBe(false)
    expect(sapFigureView(null, 500000).sapMt).toBe(500)
  })
})

describe('the badge on a SFAL / SFBD figure', () => {
  it('SAP filled it (SAP has a figure, no user wrote the column): SAP badge, no reference underneath', () => {
    const { provenance, view } = badge(497100, 497100, [])
    expect(provenance).toBe('sap')
    expect(view.referenceOnly).toBe(false)
  })

  it('a user wrote it: KLIP badge even when it equals SAP, because the data records the user', () => {
    expect(badge(497100, 497100, ['sfal_qty']).provenance).toBe('klip')
    expect(badge(111000, 305000, ['sfal_qty']).provenance).toBe('klip')
  })

  it('the marker is per column: a SFBD the user typed does not make SFAL theirs', () => {
    expect(badge(497100, 497100, ['sfbd_qty'], 'sfal_qty').provenance).toBe('sap')
    expect(badge(290000, 290000, ['sfbd_qty'], 'sfbd_qty').provenance).toBe('klip')
  })

  it('a figure that differs from SAP is KLIP even before it is saved (the user is typing)', () => {
    expect(badge(120000, 497100, []).provenance).toBe('klip')
  })

  it('empty working figure and no SAP figure: no badge, no reference', () => {
    const { provenance, view } = badge(null, null, [])
    expect(provenance).toBe('none')
    expect(view.referenceOnly).toBe(false)
  })

  it('empty working figure with a SAP figure (a multi-PO STO, or a user who cleared it): no badge, but SAP stays visible as a reference', () => {
    const { provenance, view } = badge(null, 4006260, ['sfal_qty'])
    expect(provenance).toBe('none')
    expect(view.referenceOnly).toBe(true)
    expect(view.sapMt).toBe(4006.26)
  })
})
