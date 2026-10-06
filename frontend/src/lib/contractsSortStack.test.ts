import { describe, expect, it } from 'vitest'
import {
  CONTRACTS_NODE_SORT_COLUMN_IDS,
  contractsSortStackParam,
  isStackableContractsSort,
  nextContractsSortStack,
} from './contractsSortStack'
import type { SortEntry } from './sortStack'

// the columns the server can sort at all (a stand-in for the page's resolveApiSortKey)
const API = new Set([
  'supplier',
  'product',
  'incoterm',
  'contract_date',
  'outstanding_qty_mt',
  'trade_cycle_days',
  'status_overall',
  'log_cycle_days',
])
const resolve = (id: string) => (API.has(id) ? id : null)

const click = (stack: SortEntry[], id: string) => nextContractsSortStack(stack, id, resolve)

describe('stackable columns', () => {
  it('SQL columns stack; the six Node columns and columns the server cannot sort do not', () => {
    expect(isStackableContractsSort('supplier', resolve)).toBe(true)
    expect(isStackableContractsSort('incoterm', resolve)).toBe(true)
    for (const id of CONTRACTS_NODE_SORT_COLUMN_IDS) expect(isStackableContractsSort(id, resolve)).toBe(false)
    expect(isStackableContractsSort('client_only_column', resolve)).toBe(false)
  })

  it('lists exactly the columns the backend treats as Node keys', () => {
    expect([...CONTRACTS_NODE_SORT_COLUMN_IDS].sort()).toEqual([
      'cash_cycle_days',
      'dp_cycle_days',
      'log_cycle_days',
      'over_under_delivery_status',
      'status_overall',
      'trade_cycle_days',
    ])
  })
})

describe('nextContractsSortStack', () => {
  it('Supplier, then Product, then Incoterm sorts by Incoterm, then Product, then Supplier', () => {
    let stack: SortEntry[] = [{ key: 'outstanding_qty_mt', dir: 'desc' }]
    for (const id of ['supplier', 'product', 'incoterm']) stack = click(stack, id)
    expect(stack.map((e) => e.key)).toEqual(['incoterm', 'product', 'supplier'])
  })

  it('never holds more than three columns', () => {
    let stack: SortEntry[] = []
    for (const id of ['supplier', 'product', 'incoterm', 'contract_date']) stack = click(stack, id)
    expect(stack.map((e) => e.key)).toEqual(['contract_date', 'incoterm', 'product'])
  })

  it('a Node column replaces the stack and is a single sort that flips on the next click', () => {
    let stack: SortEntry[] = [{ key: 'incoterm', dir: 'asc' }, { key: 'supplier', dir: 'asc' }]
    stack = click(stack, 'trade_cycle_days')
    expect(stack).toEqual([{ key: 'trade_cycle_days', dir: 'asc' }])
    stack = click(stack, 'trade_cycle_days')
    expect(stack).toEqual([{ key: 'trade_cycle_days', dir: 'desc' }])
  })

  it('an ordinary column after a Node sort starts a fresh stack, not a mixed one', () => {
    const stack = click([{ key: 'status_overall', dir: 'desc' }], 'supplier')
    expect(stack).toEqual([{ key: 'supplier', dir: 'asc' }])
  })

  it('a column the server cannot sort is a single sort as well', () => {
    const stack = click([{ key: 'incoterm', dir: 'asc' }, { key: 'product', dir: 'asc' }], 'client_only_column')
    expect(stack).toEqual([{ key: 'client_only_column', dir: 'asc' }])
  })

  it('clicking the top column flips it and keeps the ones beneath', () => {
    const stack = click([{ key: 'incoterm', dir: 'asc' }, { key: 'product', dir: 'asc' }], 'incoterm')
    expect(stack).toEqual([{ key: 'incoterm', dir: 'desc' }, { key: 'product', dir: 'asc' }])
  })
})

describe('contractsSortStackParam', () => {
  it('is the `sort` parameter for a stack of two or three SQL columns', () => {
    expect(
      contractsSortStackParam(
        [
          { key: 'incoterm', dir: 'asc' },
          { key: 'product', dir: 'asc' },
          { key: 'supplier', dir: 'desc' },
        ],
        resolve,
      ),
    ).toBe('incoterm:asc,product:asc,supplier:desc')
  })

  it('is empty for a single sort - sortKey and sortDir already carry it', () => {
    expect(contractsSortStackParam([{ key: 'incoterm', dir: 'asc' }], resolve)).toBe('')
    expect(contractsSortStackParam([], resolve)).toBe('')
  })

  it('is empty when the stack holds a column the server cannot stack, so the expensive path is never requested', () => {
    expect(
      contractsSortStackParam([{ key: 'incoterm', dir: 'asc' }, { key: 'trade_cycle_days', dir: 'desc' }], resolve),
    ).toBe('')
    expect(
      contractsSortStackParam([{ key: 'incoterm', dir: 'asc' }, { key: 'client_only_column', dir: 'asc' }], resolve),
    ).toBe('')
  })
})
