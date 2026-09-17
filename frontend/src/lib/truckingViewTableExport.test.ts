import { describe, expect, it } from 'vitest'
import {
  buildTruckingViewTableExportMatrix,
  resolveTruckingViewTableExportCell,
} from './truckingViewTableExport'

describe('truckingViewTableExport', () => {
  it('builds a matrix with only the supplied visible columns in picker order', () => {
    const columns = [
      { id: 'po_number', label: 'PO' },
      { id: 'contract_qty', label: 'Contract Qty' },
    ]
    const rows = [
      { po_number: '9181000090', contract_qty: 900000, supplier: 'HIDDEN' },
    ]
    const matrix = buildTruckingViewTableExportMatrix(columns, rows)
    expect(matrix[0]).toEqual(['PO', 'Contract Qty'])
    expect(matrix[1]?.[0]).toBe('9181000090')
    expect(String(matrix[1]?.[1])).toMatch(/MT/)
    expect(JSON.stringify(matrix)).not.toContain('HIDDEN')
  })

  it('formats dates, status labels, and outstanding qty', () => {
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'contract_date', label: 'Contract Date' },
        { contract_date: '2026-08-14' },
      ),
    ).toBe('14/08/2026')
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'status', label: 'Status' },
        { status: 'UNPLANNED' },
      ),
    ).toBe('Unplanned')
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'outstanding_qty_mt', label: 'Outstanding Qty' },
        { outstanding_quantity: 500000 },
      ),
    ).toMatch(/MT/)
  })

  it('treats missing delivery/receive as 0 MT and backlog STO as dash', () => {
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'quantity_delivered', label: 'Qty Delivery' },
        {},
      ),
    ).toMatch(/0 MT/)
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'outstanding_qty_mt', label: 'Outstanding Qty' },
        {},
      ),
    ).toBe('0 MT')
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'sto_number', label: 'STO' },
        { row_kind: 'contract_backlog', sto_number: 'OP-LAND-1' },
      ),
    ).toBe('-')
  })
})
