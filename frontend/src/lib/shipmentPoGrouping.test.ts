import { describe, expect, it } from 'vitest'
import { groupShipmentsBySto } from '@/lib/shipmentStoGrouping'
import {
  groupShipmentsForDisplay,
  poGroupColumnMode,
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
const display = (rows: ShipmentPoGroupRow[]) => groupShipmentsForDisplay(groupShipmentsBySto(rows))

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
    // a STO shared by two POs is one row of two POs - it belongs to no single PO header
    expect(shipmentPoGroupKey(row({ po_numbers: '111, 222' }))).toBeNull()
    expect(shipmentPoGroupKey(row({ po_numbers: '' }))).toBeNull()
    // a backlog row is not a STO row
    expect(shipmentPoGroupKey(row({ row_kind: 'contract_backlog' }))).toBeNull()
    // no STO at all
    expect(shipmentPoGroupKey({ id: 'x', incoterm: 'CIF', po_numbers: '1' })).toBeNull()
  })
})

describe('groupShipmentsForDisplay', () => {
  it('puts the STO rows of one CIF PO under one header, with the STOs listed in order', () => {
    const rows = [
      row({ sto_key: '1586005441', sto_number: '1586005441' }),
      row({ sto_key: '1586005442', sto_number: '1586005442' }),
      row({ sto_key: '1586005443', sto_number: '1586005443' }),
    ]
    const groups = display(rows)
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.kind).toBe('po')
    if (g.kind !== 'po') return
    expect(g.poNumber).toBe('1581000998')
    expect(g.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(g.stoDisplays.join(', ')).toBe('1586005441, 1586005442, 1586005443')
  })

  it('keeps the position of the PO\'s first row and gathers its later rows, even with other rows between', () => {
    const a1 = row({ po_numbers: 'A' })
    const other = row({ po_numbers: 'B', incoterm: 'FOB' })
    const a2 = row({ po_numbers: 'A' })
    const groups = display([a1, other, a2])
    expect(groups.map((g) => g.kind)).toEqual(['po', 'sto'])
    expect(groups[0].kind === 'po' && groups[0].rows.map((r) => r.id)).toEqual([a1.id, a2.id])
  })

  it('a PO with a single row is not a group', () => {
    const groups = display([row({ po_numbers: 'SOLO' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('sto')
  })

  it('FOB, a shared STO and a row with no STO stay exactly as they were', () => {
    const fob1 = row({ incoterm: 'FOB', po_numbers: 'F' })
    const fob2 = row({ incoterm: 'FOB', po_numbers: 'F' })
    const shared = row({ po_numbers: 'A, B' })
    const groups = display([fob1, fob2, shared])
    expect(groups.every((g) => g.kind === 'sto')).toBe(true)
    expect(groups).toHaveLength(3)
  })

  it('does not lose or duplicate a row', () => {
    const rows = [
      row({ po_numbers: 'A' }), row({ po_numbers: 'A' }), row({ po_numbers: 'B' }), row({ po_numbers: 'B' }),
      row({ po_numbers: 'B' }), row({ po_numbers: 'C', incoterm: 'FOB' }), row({ po_numbers: 'D' }),
    ]
    const ids = display(rows).flatMap((g) => (g.kind === 'po' ? g.rows : g.stoGroup.rows)).map((r) => r.id)
    expect(ids.sort()).toEqual(rows.map((r) => r.id).sort())
  })

  it('two rows with the SAME STO key stay one STO group inside the PO header', () => {
    const k = { sto_key: 'SAMESTO', sto_number: 'SAMESTO' }
    const g = display([row(k), row(k), row({ po_numbers: '1581000998' })])
    expect(g).toHaveLength(1)
    expect(g[0].kind === 'po' && g[0].stoGroups).toHaveLength(2)
    expect(g[0].kind === 'po' && g[0].rows).toHaveLength(3)
    expect(g[0].kind === 'po' && g[0].stoDisplays).toHaveLength(2)
  })
})

describe('what the header shows', () => {
  it('Contract Qty and Outstanding Qty once (they repeat on every sibling); per-STO quantities added up', () => {
    expect(poGroupColumnMode('contract_qty')).toBe('once')
    expect(poGroupColumnMode('outstanding_quantity')).toBe('once')
    for (const id of ['sto_quantity', 'quantity_shipment_plan', 'quantity_delivered', 'quantity_receive']) {
      expect(poGroupColumnMode(id)).toBe('sum')
    }
    expect(poGroupColumnMode('shipment_id')).toBe('sto')
    expect(poGroupColumnMode('status')).toBe('status')
    expect(poGroupColumnMode('supplier')).toBe('stack')
  })

  it('the stage ranks match the backend (furthest active wins; COMPLETED and CANCELLED below every active stage)', () => {
    expect(shipmentStageRank('UNLOADING')).toBeGreaterThan(shipmentStageRank('SAILED'))
    expect(shipmentStageRank('SAILED')).toBeGreaterThan(shipmentStageRank('LOADING'))
    expect(shipmentStageRank('LOADING')).toBeGreaterThan(shipmentStageRank('PLANNED'))
    expect(shipmentStageRank('PLANNED')).toBeGreaterThan(shipmentStageRank('COMPLETED'))
    expect(shipmentStageRank('COMPLETED')).toBe(shipmentStageRank('CANCELLED'))
    expect(shipmentStageRank(null)).toBe(shipmentStageRank('CANCELLED'))
  })

  it('the header takes the furthest active stage, where the PO\'s OS already sits on the cards', () => {
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
