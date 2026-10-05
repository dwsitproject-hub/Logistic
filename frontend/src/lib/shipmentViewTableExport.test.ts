import { describe, expect, it } from 'vitest'
import {
  buildShipmentViewTableExportMatrix,
  resolveShipmentViewTableExportCell,
} from './shipmentViewTableExport'

describe('shipmentViewTableExport', () => {
  it('builds a matrix with only the supplied visible columns in picker order', () => {
    const columns = [
      { id: 'po_numbers', label: 'PO' },
      { id: 'contract_qty', label: 'Contract Qty' },
    ]
    const rows = [
      { po_numbers: '9181000090', contract_qty: 6600000 },
      { po_numbers: '9181000091', contract_qty: 1000000, vessel_name: 'HIDDEN' },
    ]
    const matrix = buildShipmentViewTableExportMatrix(columns, rows)
    expect(matrix[0]).toEqual(['PO', 'Contract Qty (MT)'])
    expect(matrix).toHaveLength(3)
    expect(matrix[1]?.[0]).toBe('9181000090')
    expect(JSON.stringify(matrix)).not.toContain('HIDDEN')
  })

  it('exports quantities as plain MT numbers, so the column can be summed', () => {
    const columns = [{ id: 'contract_qty', label: 'Contract Qty' }]
    const matrix = buildShipmentViewTableExportMatrix(columns, [
      { contract_qty: 6600000 },
      { contract_qty: '1000000.00' },
      { contract_qty: 2410 },
    ])
    expect(matrix.slice(1).map((r) => r[0])).toEqual([6600, 1000, 2.41])
    for (const [cell] of matrix.slice(1)) expect(typeof cell).toBe('number')
  })

  it('formats dates as DD/MM/YYYY and outstanding qty as a number', () => {
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'contract_date', label: 'Contract Date' },
        { contract_date: '2026-08-14' },
      ),
    ).toBe('14/08/2026')
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'outstanding_quantity', label: 'Outstanding Qty' },
        { outstanding_quantity: 1163000, contract_qty: 6600000, incoterm: 'LCO' },
      ),
    ).toBe(1163)
  })

  it('keeps over-delivery negative instead of the on-screen "+N MT", so the column nets out', () => {
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'outstanding_quantity', label: 'Outstanding Qty' },
        { outstanding_quantity: -206000, incoterm: 'LCO' },
      ),
    ).toBe(-206)
  })

  it('exports missing qty columns as 0, as the table shows 0 MT', () => {
    expect(
      resolveShipmentViewTableExportCell({ id: 'contract_qty', label: 'Contract Qty' }, {}),
    ).toBe(0)
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'outstanding_quantity', label: 'Outstanding Qty' },
        {},
      ),
    ).toBe(0)
  })

  it('moves the unit of a vessel / percent / days column from the value to the header', () => {
    const columns = [
      { id: 'estimated_nautical_miles', label: 'Estimated NM' },
      { id: 'vessel_draft', label: 'Vessel Draft' },
      { id: 'vessel_capacity', label: 'Vessel Capacity' },
      { id: 'average_vessel_speed', label: 'Average Vessel Speed' },
      { id: 'gain_loss_percentage', label: 'Gain/Loss' },
      { id: 'trade_cycle_days', label: 'Trade Cycle' },
    ]
    const matrix = buildShipmentViewTableExportMatrix(columns, [
      {
        estimated_nautical_miles: '1,234.5',
        vessel_draft: 4.27,
        vessel_capacity: 3500,
        average_vessel_speed: 8,
        gain_loss_percentage: '-0.35',
        trade_cycle_days: -12,
      },
    ])
    expect(matrix[0]).toEqual([
      'Estimated NM',
      'Vessel Draft (m)',
      'Vessel Capacity (Kg)',
      'Average Vessel Speed (knots)',
      'Gain/Loss (%)',
      'Trade Cycle (days)',
    ])
    // bare numbers, no suffix and no thousands separator; the table shows cycle days as a magnitude
    expect(matrix[1]).toEqual([1234.5, 4.27, 3500, 8, -0.35, 12])
  })

  it('exports an unfilled vessel measure or percentage as an empty cell, not "-" text', () => {
    const matrix = buildShipmentViewTableExportMatrix(
      [
        { id: 'vessel_loa', label: 'Vessel LOA' },
        { id: 'gain_loss_percentage', label: 'Gain/Loss' },
        { id: 'vessel_registration_year', label: 'Vessel Registration Year' },
      ],
      [{ vessel_loa: 0, gain_loss_percentage: null, vessel_registration_year: 2013 }],
    )
    expect(matrix[1]).toEqual(['', '', 2013])
  })

  it('does not write a unit twice when the label already names one', () => {
    const matrix = buildShipmentViewTableExportMatrix(
      [{ id: 'freight', label: 'Freight Actual (IDR/Kg)' }],
      [{ freight: 1500 }],
    )
    expect(matrix[0]).toEqual(['Freight Actual (IDR/Kg)'])
    expect(matrix[1]).toEqual([1500])
  })

  it('exports late indicator text and hides synthetic STO on backlog rows', () => {
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'late_indicator', label: 'Late Indicators' },
        {
          delivery_end_date: '2020-01-01',
          ata_vessel_complete_discharge: '2020-01-10',
        },
      ),
    ).toBe('Late')
    expect(
      resolveShipmentViewTableExportCell(
        { id: 'shipment_id', label: 'STO' },
        { row_kind: 'contract_backlog', sto_number: 'OP-SEA-1' },
      ),
    ).toBe('-')
  })
})
