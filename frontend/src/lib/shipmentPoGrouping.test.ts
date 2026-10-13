import { describe, expect, it } from 'vitest'
import {
  joinDistinctValues,
  mergeRowsByPo,
  poGroupStatusRow,
  shipmentPoGroupKey,
  shipmentStageRank,
  type ShipmentPoGroupRow,
} from '@/lib/shipmentPoGrouping'

let n = 0
function row(over: Partial<ShipmentPoGroupRow> = {}): ShipmentPoGroupRow {
  n += 1
  return {
    id: `id-${n}`,
    sto_key: `STO${n}`,
    sto_number: `STO${n}`,
    incoterm: 'CIF',
    po_numbers: '1581000998',
    status: 'PLANNED',
    ...over,
  }
}

describe('shipmentPoGroupKey', () => {
  it('is the PO for a CIF / CFR STO row of exactly one PO', () => {
    expect(shipmentPoGroupKey(row())).toBe('po:1581000998')
    expect(shipmentPoGroupKey(row({ incoterm: 'cfr' }))).toBe('po:1581000998')
    expect(shipmentPoGroupKey(row({ po_numbers: null, po_number: '77' }))).toBe('po:77')
  })

  it('is null for everything that must keep its own row', () => {
    expect(shipmentPoGroupKey(row({ incoterm: 'FOB' }))).toBeNull()
    expect(shipmentPoGroupKey(row({ incoterm: 'FRC' }))).toBeNull()
    expect(shipmentPoGroupKey(row({ incoterm: null }))).toBeNull()
    // a STO shared by two POs is one row of two POs - it belongs to no single PO
    expect(shipmentPoGroupKey(row({ po_numbers: '111, 222' }))).toBeNull()
    expect(shipmentPoGroupKey(row({ po_numbers: '' }))).toBeNull()
    // a backlog row is not a STO row
    expect(shipmentPoGroupKey(row({ row_kind: 'contract_backlog' }))).toBeNull()
    // no STO at all
    expect(shipmentPoGroupKey({ id: 'x', incoterm: 'CIF', po_numbers: '1' })).toBeNull()
  })
})

describe('mergeRowsByPo', () => {
  it('turns the STO rows of one CIF PO into ONE row that lists the STOs in order', () => {
    const rows = [
      row({ sto_key: '1586005441', sto_number: '1586005441' }),
      row({ sto_key: '1586005442', sto_number: '1586005442' }),
      row({ sto_key: '1586005443', sto_number: '1586005443' }),
    ]
    const merged = mergeRowsByPo(rows)
    expect(merged).toHaveLength(1)
    expect(merged[0].poStos).toEqual(['1586005441', '1586005442', '1586005443'])
    expect(merged[0].poRows?.map((r) => r.id)).toEqual(rows.map((r) => r.id))
  })

  it('sits where the PO\'s first row was and takes its later rows from wherever they are', () => {
    const a1 = row({ po_numbers: 'A' })
    const other = row({ po_numbers: 'B', incoterm: 'FOB' })
    const a2 = row({ po_numbers: 'A' })
    const merged = mergeRowsByPo([a1, other, a2])
    expect(merged).toHaveLength(2)
    expect(merged[0].poRows?.map((r) => r.id)).toEqual([a1.id, a2.id])
    expect(merged[1].id).toBe(other.id)
  })

  it('the merged row IS the row whose status it shows, so its buttons act on that STO', () => {
    const planned = row({ status: 'PLANNED' })
    const loading = row({ status: 'LOADING' })
    const [merged] = mergeRowsByPo([planned, loading])
    expect(merged.id).toBe(loading.id)
    expect(merged.status).toBe('LOADING')
  })

  it('a PO with a single row is returned untouched (same object, nothing added)', () => {
    const solo = row({ po_numbers: 'SOLO' })
    const merged = mergeRowsByPo([solo])
    expect(merged[0]).toBe(solo)
    expect(merged[0].poRows).toBeUndefined()
  })

  it('FOB, a STO shared by several POs and a row with no STO come back exactly as they were', () => {
    const fob1 = row({ incoterm: 'FOB', po_numbers: 'F' })
    const fob2 = row({ incoterm: 'FOB', po_numbers: 'F' })
    const shared = row({ po_numbers: 'A, B' })
    const noSto = { id: 'no-sto', incoterm: 'CIF', po_numbers: 'Z' }
    const input = [fob1, fob2, shared, noSto]
    const merged = mergeRowsByPo(input)
    expect(merged).toHaveLength(4)
    merged.forEach((m, i) => expect(m).toBe(input[i]))
  })

  it('does not lose or duplicate a row', () => {
    const rows = [
      row({ po_numbers: 'A' }), row({ po_numbers: 'A' }), row({ po_numbers: 'B' }), row({ po_numbers: 'B' }),
      row({ po_numbers: 'B' }), row({ po_numbers: 'C', incoterm: 'FOB' }), row({ po_numbers: 'D' }),
    ]
    const merged = mergeRowsByPo(rows)
    const ids = merged.flatMap((m) => (m.poRows ? m.poRows.map((r) => r.id) : [m.id]))
    expect(ids.sort()).toEqual(rows.map((r) => r.id).sort())
    expect(merged).toHaveLength(4) // A, B, C, D
  })

  it('two rows with the SAME STO number list that STO once', () => {
    const k = { sto_key: 'SAMESTO', sto_number: 'SAMESTO' }
    const [merged] = mergeRowsByPo([row(k), row(k), row({ sto_key: 'OTHER', sto_number: 'OTHER' })])
    expect(merged.poStos).toEqual(['SAMESTO', 'OTHER'])
    expect(merged.poRows).toHaveLength(3)
  })
})

describe('what a merged row shows', () => {
  it('lists the distinct values of several rows side by side, in first-seen order, ignoring case and blanks', () => {
    expect(joinDistinctValues(['A, B', 'B, C', null, '', ' a '])).toBe('A, B, C')
    expect(joinDistinctValues(['1586005441'])).toBe('1586005441')
    expect(joinDistinctValues([null, undefined, ''])).toBe('')
  })

  it('the stage ranks match the backend (furthest active wins; COMPLETED and CANCELLED below every active stage)', () => {
    expect(shipmentStageRank('UNLOADING')).toBeGreaterThan(shipmentStageRank('SAILED'))
    expect(shipmentStageRank('SAILED')).toBeGreaterThan(shipmentStageRank('LOADING'))
    expect(shipmentStageRank('LOADING')).toBeGreaterThan(shipmentStageRank('PLANNED'))
    expect(shipmentStageRank('PLANNED')).toBeGreaterThan(shipmentStageRank('COMPLETED'))
    expect(shipmentStageRank('COMPLETED')).toBe(shipmentStageRank('CANCELLED'))
    expect(shipmentStageRank(null)).toBe(shipmentStageRank('CANCELLED'))
  })

  it('the status is the furthest active stage, where the PO\'s OS already sits on the cards', () => {
    const rows = [{ status: 'COMPLETED' }, { status: 'PLANNED' }, { status: 'LOADING' }, { status: 'PLANNED' }]
    expect(poGroupStatusRow(rows).status).toBe('LOADING')
    expect(poGroupStatusRow([{ status: 'COMPLETED' }, { status: 'PLANNED' }]).status).toBe('PLANNED')
  })

  it('with nothing active, Completed beats Cancelled; equal stages keep list order', () => {
    expect(poGroupStatusRow([{ status: 'CANCELLED' }, { status: 'COMPLETED' }]).status).toBe('COMPLETED')
    const first = { status: 'PLANNED', id: 'first' }
    const second = { status: 'PLANNED', id: 'second' }
    expect(poGroupStatusRow([first, second]).id).toBe('first')
  })
})
