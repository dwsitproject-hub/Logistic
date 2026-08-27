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
    expect(matrix[0]).toEqual(['PO', 'Contract Qty'])
    expect(matrix).toHaveLength(3)
    expect(matrix[1]?.[0]).toBe('9181000090')
    expect(String(matrix[1]?.[1])).toMatch(/MT/)
    expect(JSON.stringify(matrix)).not.toContain('HIDDEN')
  })

  it('formats dates as DD/MM/YYYY and outstanding qty as MT', () => {
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
    ).toMatch(/MT/)
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
