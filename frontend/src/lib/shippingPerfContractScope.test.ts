import { describe, expect, it } from 'vitest'
import {
  collapseContractScopeRows,
  expandContractScopeRows,
  uniqueContractScopeParents,
  type ShippingPerfContractScopeGroup,
} from './shippingPerfContractScope'

type Row = {
  id: string
  product: string | null
  contract_number: string
  outstanding_qty_aggregate?: number | null
  contract_scope?: ShippingPerfContractScopeGroup[] | null
  scope_parent?: Row
}

const group = (contract: string, product: string, kg: number): ShippingPerfContractScopeGroup => ({
  contract_number: contract,
  product,
  incoterm: 'CIF',
  source_type: '3rd Party',
  supplier: 'S',
  group_name: 'G',
  plant_site: 'BONTANG',
  contract_date: '2026-08-01',
  outstanding_qty_aggregate: kg,
})

// one vessel: three CPO contracts and one POME contract, the row labelled CPO as the page labels it
const mixed: Row = {
  id: 'sto-1',
  product: 'CPO',
  contract_number: 'A, B, C, D',
  outstanding_qty_aggregate: 9_000_000,
  contract_scope: [group('A, B, C', 'CPO', 4_000_000), group('D', 'POME', 5_000_000)],
}
const plain: Row = { id: 'sto-2', product: 'CPO', contract_number: 'E', outstanding_qty_aggregate: 1_000_000 }

const sumOs = (rows: Row[]) => rows.reduce((a, r) => a + (Number(r.outstanding_qty_aggregate) || 0), 0)
const pick = (rows: Row[], product: string) => rows.filter((r) => r.product === product)

describe('a STO row that spans contracts of two products is filtered per contract', () => {
  it('splits the mixed row into one row per group and leaves the other row alone', () => {
    const rows = expandContractScopeRows([mixed, plain])
    expect(rows.map((r) => [r.id, r.product, r.contract_number])).toEqual([
      ['sto-1', 'CPO', 'A, B, C'],
      ['sto-1', 'POME', 'D'],
      ['sto-2', 'CPO', 'E'],
    ])
    expect(rows[2]).toBe(plain)
  })

  it('picking CPO counts the CPO contracts only - the POME one on the same vessel no longer rides along', () => {
    const rows = expandContractScopeRows([mixed, plain])
    expect(sumOs(pick(rows, 'CPO'))).toBe(5_000_000)
    expect(sumOs(pick(rows, 'POME'))).toBe(5_000_000)
  })

  it('without a filter the total is what the row carried before', () => {
    expect(sumOs(expandContractScopeRows([mixed, plain]))).toBe(10_000_000)
    expect(sumOs(collapseContractScopeRows(expandContractScopeRows([mixed, plain])))).toBe(10_000_000)
  })

  it('collapses back to the STO row, which keeps its full label and carries the outstanding of the groups that survived', () => {
    const cpo = collapseContractScopeRows(pick(expandContractScopeRows([mixed, plain]), 'CPO'))
    expect(cpo.map((r) => r.id)).toEqual(['sto-1', 'sto-2'])
    expect(cpo[0]!.contract_number).toBe('A, B, C, D')
    expect(cpo[0]!.product).toBe('CPO')
    expect(cpo[0]!.outstanding_qty_aggregate).toBe(4_000_000)
    // the row that was fetched is not modified
    expect(mixed.outstanding_qty_aggregate).toBe(9_000_000)
  })

  it('a STO whose groups all survive is one row again, not one per group', () => {
    const rows = collapseContractScopeRows(expandContractScopeRows([mixed]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.outstanding_qty_aggregate).toBe(9_000_000)
  })

  it('counts and averages see the STO once however many groups it was split into', () => {
    expect(uniqueContractScopeParents(expandContractScopeRows([mixed, plain]))).toHaveLength(2)
  })

  it('a row without contract_scope is not split', () => {
    expect(expandContractScopeRows([plain])).toEqual([plain])
  })

  it('a single group still takes over the row\'s values, for a contract whose own supplier is not the row\'s', () => {
    const relabelled: Row = {
      id: 'sto-3',
      product: 'CPO',
      contract_number: 'E',
      outstanding_qty_aggregate: 4_500_000,
      contract_scope: [{ ...group('E', 'CPO', 4_500_000), supplier: 'BUMI INDAWA' }],
    }
    const [scoped] = expandContractScopeRows([relabelled]) as Array<Row & { supplier?: string }>
    expect(scoped!.supplier).toBe('BUMI INDAWA')
    expect(collapseContractScopeRows([scoped!])[0]!.id).toBe('sto-3')
  })

  it('a group with nothing awarded to this row keeps the row in scope with 0, and costs nothing', () => {
    const lost: Row = {
      id: 'sto-4',
      product: 'CPO',
      contract_number: 'A, D',
      outstanding_qty_aggregate: 0,
      contract_scope: [group('A', 'CPO', 0), group('D', 'POME', 0)],
    }
    const rows = expandContractScopeRows([lost])
    expect(sumOs(pick(rows, 'POME'))).toBe(0)
    expect(collapseContractScopeRows(pick(rows, 'POME'))[0]!.outstanding_qty_aggregate).toBe(0)
  })
})
