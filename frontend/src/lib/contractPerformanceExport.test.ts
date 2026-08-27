import { describe, expect, it } from 'vitest'
import { buildContractPerfVisibleColumns } from './contractPerformanceColumns'
import {
  buildContractPerfExportMatrix,
  contractPerfQtySortValue,
  formatContractViewTableReceiveQtyMt,
  parseContractPerfKg,
  resolveContractPerfExportCell,
  type ContractPerfExportColumn,
} from './contractPerformanceExport'

type Row = Record<string, unknown>

const formatters = {
  formatStatusOverall: (row: Row) => String(row.status_overall_label || row.import_status || '-'),
}

function col(
  id: string,
  label: string,
  getSortValue?: ContractPerfExportColumn['getSortValue'],
): ContractPerfExportColumn {
  return { id, label, getSortValue }
}

describe('parseContractPerfKg', () => {
  it('parses pg numeric strings that used to collapse to 0 in export', () => {
    expect(parseContractPerfKg('3002849.00')).toBe(3002849)
    expect(parseContractPerfKg(3002849)).toBe(3002849)
    expect(parseContractPerfKg(null)).toBeNull()
    expect(parseContractPerfKg('')).toBeNull()
    expect(contractPerfQtySortValue('3002849.00')).toBe(3002849)
    expect(contractPerfQtySortValue(undefined)).toBe(0)
  })
})

describe('formatContractViewTableReceiveQtyMt', () => {
  it('shows 0 MT when KLIP and SAP receive qty are null', () => {
    expect(formatContractViewTableReceiveQtyMt(null)).toBe('0 MT')
    expect(formatContractViewTableReceiveQtyMt(undefined)).toBe('0 MT')
    expect(formatContractViewTableReceiveQtyMt('')).toBe('0 MT')
  })

  it('formats a real receive qty in MT', () => {
    expect(formatContractViewTableReceiveQtyMt(1000)).toBe('1 MT')
  })
})

describe('buildContractPerfExportMatrix', () => {
  const allColumns: ContractPerfExportColumn[] = [
    col('contract_date', 'Contract Date', (r) => String(r.contract_date || '')),
    col('supplier', 'Supplier', (r) => String(r.supplier || '')),
    col('contract_qty', 'Contract Qty'),
    col('delivery_qty', 'Delivery Qty'),
    col('outstanding_qty_mt', 'Outstanding Qty'),
    col('received_qty', 'Received Qty'),
    col('trade_cycle_days', 'Trade Cycle'),
    col('created_at', 'Created', (r) => String(r.created_at || '')),
    col('status_overall', 'Status'),
  ]

  const row: Row = {
    contract_date: '2026-08-01T00:00:00.000Z',
    supplier: 'PT Test Supplier',
    quantity_ordered: '3002849.00',
    quantity_delivery: 3002849,
    outstanding_quantity: '1500000',
    quantity_receive: null,
    trade_cycle_days: null,
    created_at: '2026-08-10',
    import_status: 'OPEN',
    status_overall_label: 'Open',
  }

  it('exports only columns the user set visible, in picker order', () => {
    const visibleIds = new Set(['delivery_qty', 'contract_qty', 'supplier'])
    const visible = buildContractPerfVisibleColumns(allColumns, visibleIds, [
      'supplier',
      'delivery_qty',
      'contract_qty',
    ])
    const matrix = buildContractPerfExportMatrix(visible, [row], formatters)

    expect(matrix[0]).toEqual(['Supplier', 'Delivery Qty', 'Contract Qty'])
    expect(matrix[0]).not.toContain('Created')
    expect(matrix[0]).not.toContain('Received Qty')
    expect(matrix[1]).toHaveLength(3)
    expect(matrix[1][0]).toBe('PT Test Supplier')
  })

  it('formats kg quantity strings the same way as the table (MT), not 0/blank', () => {
    const visible = allColumns.filter((c) =>
      ['contract_qty', 'delivery_qty', 'outstanding_qty_mt', 'received_qty'].includes(c.id),
    )
    const matrix = buildContractPerfExportMatrix(visible, [row], formatters)
    expect(matrix[1][0]).toBe('3,003 MT')
    expect(matrix[1][1]).toBe('3,003 MT')
    expect(matrix[1][2]).toBe('1,500 MT')
    expect(matrix[1][3]).toBe('0 MT')
  })

  it('exports missing outstanding qty as 0 MT', () => {
    expect(
      resolveContractPerfExportCell(
        col('outstanding_qty_mt', 'Outstanding Qty'),
        {},
        formatters,
      ),
    ).toBe('0 MT')
    expect(
      resolveContractPerfExportCell(
        col('contract_qty', 'Contract Qty'),
        {},
        formatters,
      ),
    ).toBe('0 MT')
  })

  it('exports "-" for missing cycle days instead of 0', () => {
    const cell = resolveContractPerfExportCell(
      col('trade_cycle_days', 'Trade Cycle'),
      row,
      formatters,
    )
    expect(cell).toBe('-')
    expect(
      resolveContractPerfExportCell(
        col('trade_cycle_days', 'Trade Cycle'),
        { trade_cycle_days: 5 },
        formatters,
      ),
    ).toBe('5 days')
  })

  it('formats calendar dates as DD/MM/YYYY', () => {
    expect(
      resolveContractPerfExportCell(
        col('contract_date', 'Contract Date', (r) => String(r.contract_date || '')),
        row,
        formatters,
      ),
    ).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('omits hidden columns even when they have values', () => {
    const visibleIds = new Set(['contract_qty'])
    const visible = buildContractPerfVisibleColumns(allColumns, visibleIds)
    const matrix = buildContractPerfExportMatrix(visible, [row], formatters)
    expect(matrix[0]).toEqual(['Contract Qty'])
    expect(matrix[1]).toEqual(['3,003 MT'])
  })
})
