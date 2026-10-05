import { describe, expect, it } from 'vitest'
import {
  clickSortStack,
  compareByStack,
  parseSortStack,
  serializeSortStack,
  sortPriority,
  sortRowsByStack,
  type SortEntry,
  type SortValue,
} from './sortStack'

type Row = { supplier: string; product: string; incoterm: string; qty: number | null }
const text = (v: string): SortValue => ({ type: 'text', value: v })

const valueOf = (row: Row, key: string): SortValue =>
  key === 'qty' ? { type: 'number', value: row.qty } : text(String(row[key as keyof Row] ?? ''))

describe('clickSortStack', () => {
  it('starts a stack with the first click, ascending', () => {
    expect(clickSortStack([], 'supplier')).toEqual([{ key: 'supplier', dir: 'asc' }])
  })

  it('clicking the column on top flips it - the single-sort behaviour the tables already have', () => {
    const once = clickSortStack([], 'supplier')
    const twice = clickSortStack(once, 'supplier')
    expect(twice).toEqual([{ key: 'supplier', dir: 'desc' }])
    expect(clickSortStack(twice, 'supplier')).toEqual([{ key: 'supplier', dir: 'asc' }])
  })

  it('the last click is the primary key: supplier, product, incoterm -> incoterm, product, supplier', () => {
    let stack: SortEntry[] = []
    for (const key of ['supplier', 'product', 'incoterm']) stack = clickSortStack(stack, key)
    expect(stack.map((e) => e.key)).toEqual(['incoterm', 'product', 'supplier'])
    expect(sortPriority(stack, 'incoterm')).toBe(1)
    expect(sortPriority(stack, 'product')).toBe(2)
    expect(sortPriority(stack, 'supplier')).toBe(3)
    expect(sortPriority(stack, 'qty')).toBeNull()
  })

  it('a column clicked again from lower down moves to the top, ascending, and leaves its old place', () => {
    let stack = clickSortStack(clickSortStack(clickSortStack([], 'supplier'), 'product'), 'incoterm')
    stack = clickSortStack(stack, 'supplier')
    expect(stack).toEqual([
      { key: 'supplier', dir: 'asc' },
      { key: 'incoterm', dir: 'asc' },
      { key: 'product', dir: 'asc' },
    ])
  })

  it('drops the oldest key once the stack is deeper than the limit', () => {
    let stack: SortEntry[] = []
    for (const key of ['a', 'b', 'c', 'd']) stack = clickSortStack(stack, key, 3)
    expect(stack.map((e) => e.key)).toEqual(['d', 'c', 'b'])
  })

  it('keeps the direction of the keys underneath when the top one is flipped', () => {
    const stack: SortEntry[] = [
      { key: 'incoterm', dir: 'asc' },
      { key: 'product', dir: 'desc' },
    ]
    expect(clickSortStack(stack, 'incoterm')).toEqual([
      { key: 'incoterm', dir: 'desc' },
      { key: 'product', dir: 'desc' },
    ])
  })

  it('never returns an empty stack, even with a silly limit', () => {
    expect(clickSortStack([], 'a', 0)).toHaveLength(1)
  })

  it('does not change the stack it was given', () => {
    const stack: SortEntry[] = [{ key: 'a', dir: 'asc' }]
    clickSortStack(stack, 'b')
    expect(stack).toEqual([{ key: 'a', dir: 'asc' }])
  })
})

describe('serializeSortStack / parseSortStack', () => {
  it('round-trips', () => {
    const stack: SortEntry[] = [
      { key: 'incoterm', dir: 'asc' },
      { key: 'product', dir: 'desc' },
      { key: 'supplier', dir: 'asc' },
    ]
    const text = serializeSortStack(stack)
    expect(text).toBe('incoterm:asc,product:desc,supplier:asc')
    expect(parseSortStack(text)).toEqual(stack)
  })

  it('drops what it cannot trust instead of guessing', () => {
    expect(parseSortStack('incoterm:asc,incoterm:desc,product:sideways,,supplier')).toEqual([
      { key: 'incoterm', dir: 'asc' },
      { key: 'supplier', dir: 'asc' },
    ])
    expect(parseSortStack('a:asc,b:asc,c:asc,d:asc')).toHaveLength(3)
    expect(parseSortStack('a:asc,b:asc', { allowedKeys: new Set(['b']) })).toEqual([{ key: 'b', dir: 'asc' }])
    expect(parseSortStack(undefined)).toEqual([])
    expect(parseSortStack(42)).toEqual([])
  })
})

describe('sortRowsByStack', () => {
  const rows: Row[] = [
    { supplier: 'B', product: 'CPO', incoterm: 'FOB', qty: 5 },
    { supplier: 'A', product: 'PK', incoterm: 'CIF', qty: 1 },
    { supplier: 'A', product: 'CPO', incoterm: 'FOB', qty: null },
    { supplier: 'C', product: 'CPO', incoterm: 'CIF', qty: 9 },
    { supplier: 'B', product: 'PK', incoterm: 'CIF', qty: 3 },
  ]
  const order = (stack: SortEntry[]) => sortRowsByStack(rows, stack, valueOf).map((r) => `${r.incoterm}/${r.product}/${r.supplier}`)

  it('orders by incoterm, then product within an incoterm, then supplier within a product', () => {
    const stack: SortEntry[] = [
      { key: 'incoterm', dir: 'asc' },
      { key: 'product', dir: 'asc' },
      { key: 'supplier', dir: 'asc' },
    ]
    expect(order(stack)).toEqual(['CIF/CPO/C', 'CIF/PK/A', 'CIF/PK/B', 'FOB/CPO/A', 'FOB/CPO/B'])
  })

  it('a key lower in the stack only breaks ties of the keys above it', () => {
    expect(order([{ key: 'incoterm', dir: 'desc' }, { key: 'supplier', dir: 'asc' }])).toEqual([
      'FOB/CPO/A',
      'FOB/CPO/B',
      'CIF/PK/A',
      'CIF/PK/B',
      'CIF/CPO/C',
    ])
  })

  it('sorts numbers as numbers, with an empty value smallest, and text case-insensitively', () => {
    expect(sortRowsByStack(rows, [{ key: 'qty', dir: 'asc' }], valueOf).map((r) => r.qty)).toEqual([null, 1, 3, 5, 9])
    expect(sortRowsByStack(rows, [{ key: 'qty', dir: 'desc' }], valueOf).map((r) => r.qty)).toEqual([9, 5, 3, 1, null])
    const mixed = [{ s: 'beta' }, { s: 'Alpha' }, { s: 'alpha2' }]
    expect(
      sortRowsByStack(mixed, [{ key: 's', dir: 'asc' }], (r) => text(r.s)).map((r) => r.s),
    ).toEqual(['Alpha', 'alpha2', 'beta'])
  })

  it('keeps the incoming order for rows that tie on every key, and leaves its input alone', () => {
    const tie = [
      { n: 1, k: 'x' },
      { n: 2, k: 'x' },
      { n: 3, k: 'x' },
    ]
    const copy = [...tie]
    expect(sortRowsByStack(tie, [{ key: 'k', dir: 'desc' }], (r) => text(r.k)).map((r) => r.n)).toEqual([1, 2, 3])
    expect(tie).toEqual(copy)
  })

  it('an empty stack is the incoming order', () => {
    expect(sortRowsByStack(rows, [], valueOf)).toEqual(rows)
  })

  it('compareByStack is symmetric', () => {
    const stack: SortEntry[] = [{ key: 'incoterm', dir: 'asc' }, { key: 'supplier', dir: 'desc' }]
    for (const a of rows) {
      for (const b of rows) {
        expect(Math.sign(compareByStack(a, b, stack, valueOf))).toBe(-Math.sign(compareByStack(b, a, stack, valueOf)) || 0)
      }
    }
  })
})
