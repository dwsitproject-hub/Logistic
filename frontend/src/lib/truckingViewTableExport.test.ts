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
    expect(matrix[0]).toEqual(['PO', 'Contract Qty (MT)'])
    expect(matrix[1]).toEqual(['9181000090', 900])
    expect(JSON.stringify(matrix)).not.toContain('HIDDEN')
  })

  it('formats dates and status labels, and outstanding qty as a plain MT number', () => {
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
    ).toBe(500)
  })

  it('treats missing delivery/receive as 0 and backlog STO as dash', () => {
    expect(
      resolveTruckingViewTableExportCell({ id: 'quantity_delivered', label: 'Qty Delivery' }, {}),
    ).toBe(0)
    expect(
      resolveTruckingViewTableExportCell({ id: 'outstanding_qty_mt', label: 'Outstanding Qty' }, {}),
    ).toBe(0)
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'sto_number', label: 'STO' },
        { row_kind: 'contract_backlog', sto_number: 'OP-LAND-1' },
      ),
    ).toBe('-')
  })

  it('keeps over-delivery negative instead of the on-screen "+N MT", so the column nets out', () => {
    expect(
      resolveTruckingViewTableExportCell(
        { id: 'outstanding_qty_mt', label: 'Outstanding Qty' },
        { outstanding_quantity: -206000 },
      ),
    ).toBe(-206)
  })

  it('moves the unit of percent / amount / distance columns from the value to the header', () => {
    const matrix = buildTruckingViewTableExportMatrix(
      [
        { id: 'gain_loss_percentage', label: 'Gain/Loss' },
        { id: 'gain_loss_amount', label: 'Gain/Loss Amount (Kg)' },
        { id: 'estimated_km', label: 'Estimated KM' },
      ],
      [{ gain_loss_percentage: '-0.35', gain_loss_amount: '-1,250.5', estimated_km: 120 }],
    )
    // a label that already names its unit - in brackets or as a word - is not given a second one
    expect(matrix[0]).toEqual(['Gain/Loss (%)', 'Gain/Loss Amount (Kg)', 'Estimated KM'])
    expect(matrix[1]).toEqual([-0.35, -1250.5, 120])
  })

  it('exports OA amounts as numbers with the currency in its own column', () => {
    const matrix = buildTruckingViewTableExportMatrix(
      [
        { id: 'po_number', label: 'PO' },
        { id: 'oa_budget', label: 'Trucking OA Budget' },
        { id: 'oa_actual', label: 'Trucking OA Actual' },
      ],
      [
        { po_number: 'P1', oa_budget: '5,000', oa_budget_currency: 'IDR', oa_actual: 4500, oa_actual_currency: 'IDR' },
        { po_number: 'P2', oa_budget: null, oa_actual: null },
      ],
    )
    expect(matrix[0]).toEqual([
      'PO',
      'Trucking OA Budget',
      'Trucking OA Budget Currency',
      'Trucking OA Actual',
      'Trucking OA Actual Currency',
    ])
    expect(matrix[1]).toEqual(['P1', 5000, 'IDR', 4500, 'IDR'])
    // a missing amount is an empty cell, so COUNT counts only rows that have one
    expect(matrix[2]).toEqual(['P2', '', '', '', ''])
  })
})
