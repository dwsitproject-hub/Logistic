import { describe, expect, it } from 'vitest'
import {
  isStackableShipmentsSort,
  nextShipmentsSortStack,
  shipmentsSortStackParam,
  SHIPMENTS_SERVER_SORT_KEYS,
} from './shipmentsSortStack'
import type { SortEntry } from './sortStack'

describe('Shipments sort stack', () => {
  it('Supplier, then Product, then Incoterm sorts by Incoterm, Product, Supplier', () => {
    let stack: SortEntry[] = [{ key: 'created_at', dir: 'desc' }]
    for (const id of ['supplier', 'product', 'incoterm']) stack = nextShipmentsSortStack(stack, id)
    expect(stack.map((e) => e.key)).toEqual(['incoterm', 'product', 'supplier'])
  })

  it('never holds more than three columns', () => {
    let stack: SortEntry[] = []
    for (const id of ['supplier', 'product', 'incoterm', 'vessel_name']) stack = nextShipmentsSortStack(stack, id)
    expect(stack.map((e) => e.key)).toEqual(['vessel_name', 'incoterm', 'product'])
  })

  it('a column the server cannot order by is a single sort that flips on the next click', () => {
    let stack: SortEntry[] = [{ key: 'incoterm', dir: 'asc' }, { key: 'supplier', dir: 'asc' }]
    stack = nextShipmentsSortStack(stack, 'jetty_status')
    expect(stack).toEqual([{ key: 'jetty_status', dir: 'asc' }])
    stack = nextShipmentsSortStack(stack, 'jetty_status')
    expect(stack).toEqual([{ key: 'jetty_status', dir: 'desc' }])
  })

  it('an ordinary column after a single sort starts a fresh stack, not a mixed one', () => {
    expect(nextShipmentsSortStack([{ key: 'jetty_status', dir: 'desc' }], 'supplier')).toEqual([
      { key: 'supplier', dir: 'asc' },
    ])
  })

  it('SAP / qty columns and backlog-only columns may stack: the server orders them', () => {
    for (const id of ['contract_qty', 'outstanding_quantity', 'quantity_delivered', 'loading_port', 'pre_planned_group']) {
      expect(isStackableShipmentsSort(id)).toBe(true)
    }
    expect(isStackableShipmentsSort('jetty_status')).toBe(false)
    expect(SHIPMENTS_SERVER_SORT_KEYS.has('jetty_status')).toBe(false)
  })

  it('the `sort` parameter is only sent for two or more keys the server can stack', () => {
    expect(
      shipmentsSortStackParam([
        { key: 'incoterm', dir: 'asc' },
        { key: 'product', dir: 'asc' },
        { key: 'supplier', dir: 'desc' },
      ]),
    ).toBe('incoterm:asc,product:asc,supplier:desc')
    expect(shipmentsSortStackParam([{ key: 'incoterm', dir: 'asc' }])).toBe('')
    expect(
      shipmentsSortStackParam([{ key: 'incoterm', dir: 'asc' }, { key: 'jetty_status', dir: 'asc' }]),
    ).toBe('')
  })
})
