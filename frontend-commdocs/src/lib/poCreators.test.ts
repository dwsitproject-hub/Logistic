import { describe, expect, it } from 'vitest'
import { readPoCreators } from './poCreators'

const HEAD = ['Purchasing Document', 'Plant', 'Created by', 'Deletion indicator']

describe('readPoCreators', () => {
  it('reads one creator per PO from a report with one row per item', () => {
    const r = readPoCreators([HEAD, ['1001', 'EU51', '04124040143', ''], ['1001', 'EU51', '04124040143', ''], ['1002', 'EU22', 62237590905, '']])
    expect(r?.rows).toEqual([
      { po_number: '1001', created_by: '04124040143' },
      { po_number: '1002', created_by: '62237590905' },
    ])
    expect(r).toMatchObject({ creators: 2, conflicts: 0, skipped: 0 })
  })
  it('finds the header by name, wherever the columns are', () => {
    const r = readPoCreators([['title row'], ['Created by', 'Item', 'purchasing document'], ['U1', '1', '5001']])
    expect(r?.rows).toEqual([{ po_number: '5001', created_by: 'U1' }])
  })
  it('keeps the first creator of a PO and counts the PO once when it shows two', () => {
    const r = readPoCreators([HEAD, ['1001', '', 'A', ''], ['1001', '', 'B', ''], ['1001', '', 'C', '']])
    expect(r?.rows).toEqual([{ po_number: '1001', created_by: 'A' }])
    expect(r?.conflicts).toBe(1)
  })
  it('skips rows with a PO but no creator (or the reverse), and ignores blank rows', () => {
    const r = readPoCreators([HEAD, ['1001', '', '', ''], ['', '', 'A', ''], ['', '', '', ''], ['1002', '', 'A', '']])
    expect(r?.rows).toEqual([{ po_number: '1002', created_by: 'A' }])
    expect(r?.skipped).toBe(2)
  })
  it('is null for a sheet without the two columns', () => {
    expect(readPoCreators([['PO', 'Plant'], ['1', 'x']])).toBeNull()
  })
})
