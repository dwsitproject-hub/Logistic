import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildShipmentGroupingTemplateMatrix,
  clusterShipmentGroupingRowsByGroup,
  compareShipmentGroupingTemplateRows,
  formatGroupingQtyMtFromKg,
  isSelectY,
  isShipmentGroupingTemplateHeaderRow,
  isShipmentGroupingTemplateMode,
  matchGroupingRowsToContracts,
  parseShipmentGroupingMatrix,
  SHIPMENT_GROUPING_TEMPLATE_HEADERS,
  sortShipmentGroupingTemplateRows,
  SHIPMENT_GROUPING_INSTRUCTION,
  buildShipmentGroupingTemplateXlsxBuffer,
  type ParsedShipmentGroupingRow,
} from './shipmentGroupingTemplate'

function selected(
  over: Partial<ParsedShipmentGroupingRow> & Pick<ParsedShipmentGroupingRow, 'excelRowNumber' | 'group'>,
): ParsedShipmentGroupingRow {
  return {
    selectY: true,
    poNumber: '',
    supplier: '',
    ...over,
  }
}

describe('shipmentGroupingTemplate', () => {
  it('enables download only for Unplanned', () => {
    expect(isShipmentGroupingTemplateMode('UNPLANNED')).toBe(true)
    expect(isShipmentGroupingTemplateMode('PREPLANNED')).toBe(false)
    expect(isShipmentGroupingTemplateMode('PLANNED')).toBe(false)
    expect(isShipmentGroupingTemplateMode('ALL')).toBe(false)
  })

  it('treats only Y as selected', () => {
    expect(isSelectY('Y')).toBe(true)
    expect(isSelectY(' y ')).toBe(true)
    expect(isSelectY('YES')).toBe(false)
    expect(isSelectY('1')).toBe(false)
    expect(isSelectY('')).toBe(false)
    expect(isSelectY(null)).toBe(false)
  })

  it('includes PO Number and Contract Qty (MT) in the header', () => {
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('PO Number')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('Contract Qty (MT)')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS[0]).toBe('Select')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS[1]).toBe('Group')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Vessel')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Plan Qty (MT)')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract Ext No')
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract No')
    expect(SHIPMENT_GROUPING_INSTRUCTION).not.toMatch(/WILMAR/i)
    expect(SHIPMENT_GROUPING_INSTRUCTION).toMatch(/contoh 1 atau A/)
  })

  it('sorts by supplier then region/plant, product, incoterm, contract date, PO', () => {
    const rows = [
      {
        supplier: 'Wilmar',
        plantSite: 'BONTANG',
        product: 'CPO',
        incoterm: 'CIF',
        poNumber: '2',
        contractDate: '2026-02-01',
      },
      {
        supplier: 'Astra',
        plantSite: 'KIJING',
        product: 'PK',
        incoterm: 'FOB',
        poNumber: '9',
        contractDate: '2026-01-01',
      },
      {
        supplier: 'Wilmar',
        plantSite: 'BONTANG',
        product: 'CPO',
        incoterm: 'CIF',
        poNumber: '1',
        contractDate: '2026-02-01',
      },
    ]
    const sorted = sortShipmentGroupingTemplateRows(rows)
    expect(sorted.map((r) => r.poNumber)).toEqual(['9', '1', '2'])
    expect(compareShipmentGroupingTemplateRows(sorted[0]!, sorted[1]!)).toBeLessThan(0)
  })

  it('builds a matrix with empty Select/Group and Unplanned status', () => {
    const matrix = buildShipmentGroupingTemplateMatrix([
      {
        supplier: 'Wilmar',
        plantSite: 'TANJUNG PURA',
        product: 'CPO',
        incoterm: 'CIF',
        buyer: 'KPN',
        poNumber: '1001',
        contractDate: '2026-03-15',
        contractQtyKg: 2500000,
        outstandingQtyKg: 1200500,
      },
    ])
    expect(matrix[1]).toEqual([...SHIPMENT_GROUPING_TEMPLATE_HEADERS])
    const data = matrix[2] as string[]
    expect(data[0]).toBe('')
    expect(data[1]).toBe('')
    expect(data[7]).toBe('1001')
    expect(data[9]).toBe(formatGroupingQtyMtFromKg(2500000))
    expect(data[9]).toBe('2500')
    expect(data[10]).toBe('1200.5')
    expect(data[11]).toBe('Unplanned')
  })

  it('skips rows without Y even if Group is leftover', () => {
    const matrix = [
      ['Select', 'Group', 'PO Number'],
      ['', 'A', '1001'],
      ['Y', 'A', '1002'],
      ['n', '2', '1003'],
    ]
    const parsed = parseShipmentGroupingMatrix(matrix)
    expect(parsed.selectedRows).toHaveLength(1)
    expect(parsed.selectedRows[0]?.poNumber).toBe('1002')
    expect(parsed.skippedWithoutY).toBe(2)
    expect(parsed.issues).toHaveLength(0)
  })

  it('requires Group when Select is Y', () => {
    const matrix = [
      ['Select', 'Group', 'PO Number'],
      ['Y', '', '1001'],
    ]
    const parsed = parseShipmentGroupingMatrix(matrix)
    expect(parsed.selectedRows).toHaveLength(0)
    expect(parsed.issues[0]?.reason).toBe('isi Group')
  })

  it('clusters selected rows by Group code', () => {
    const clusters = clusterShipmentGroupingRowsByGroup([
      selected({ excelRowNumber: 3, group: 'A', poNumber: '1' }),
      selected({ excelRowNumber: 4, group: 'B', poNumber: '2' }),
      selected({ excelRowNumber: 5, group: 'A', poNumber: '3' }),
    ])
    expect(clusters.map((c) => c.group)).toEqual(['A', 'B'])
    expect(clusters[0]?.rows).toHaveLength(2)
    expect(clusters[1]?.rows).toHaveLength(1)
  })

  it('matches by PO Number only and rejects unknown POs', () => {
    const matches = matchGroupingRowsToContracts(
      [
        selected({ excelRowNumber: 3, group: '1', poNumber: '1001' }),
        selected({ excelRowNumber: 4, group: '1', poNumber: '9999' }),
      ],
      [
        { id: 'uuid-1', poNumber: '1001' },
        { id: 'uuid-2', poNumber: '1002' },
      ],
    )
    expect(matches[0]).toMatchObject({ ok: true, contractId: 'uuid-1' })
    expect(matches[1]?.ok).toBe(false)
  })

  it('rejects the same PO assigned to two Groups', () => {
    const matches = matchGroupingRowsToContracts(
      [
        selected({ excelRowNumber: 3, group: 'A', poNumber: '1001' }),
        selected({ excelRowNumber: 4, group: 'B', poNumber: '1001' }),
      ],
      [{ id: 'uuid-1', poNumber: '1001' }],
    )
    expect(matches[0]?.ok).toBe(true)
    expect(matches[1]?.ok).toBe(false)
    if (matches[1]?.ok === false) {
      expect(matches[1].reason).toContain('already assigned')
    }
  })

  it('detects grouping header rows', () => {
    expect(isShipmentGroupingTemplateHeaderRow([...SHIPMENT_GROUPING_TEMPLATE_HEADERS])).toBe(true)
    expect(isShipmentGroupingTemplateHeaderRow(['Group', 'PO', 'Plan Qty (MT)'])).toBe(false)
  })

  it('round-trips Select/Group through an xlsx buffer parse', () => {
    const matrix = buildShipmentGroupingTemplateMatrix([
      { supplier: 'A', poNumber: '11', contractQtyKg: 1000 },
      { supplier: 'B', poNumber: '22', contractQtyKg: 2000 },
    ])
    matrix[2]![0] = 'Y'
    matrix[2]![1] = 'A'
    matrix[3]![0] = 'Y'
    matrix[3]![1] = 'A'
    const ws = XLSX.utils.aoa_to_sheet(matrix)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Grouping')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const read = XLSX.read(buf, { type: 'array' })
    const parsedMatrix = XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]!]!, {
      header: 1,
      defval: '',
    }) as unknown[][]
    const parsed = parseShipmentGroupingMatrix(parsedMatrix)
    expect(parsed.selectedRows).toHaveLength(2)
    expect(parsed.selectedRows.every((r) => r.group === 'A')).toBe(true)
  })

  it('keeps Cara isi examples as 1/A/B without WILMAR', () => {
    const buf = buildShipmentGroupingTemplateXlsxBuffer([])
    const wb = XLSX.read(buf, { type: 'array' })
    const help = XLSX.utils.sheet_to_json(wb.Sheets['Cara isi']!, {
      header: 1,
      defval: '',
    }) as unknown[][]
    const text = help.flat().join(' ')
    expect(text).not.toMatch(/WILMAR/i)
    expect(text).toMatch(/contoh: 1, A, B/)
  })
})
