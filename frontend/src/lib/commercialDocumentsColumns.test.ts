import { describe, expect, it } from 'vitest'
import {
  commercialDocsDynamicColumnWidthPx,
  commercialDocsTableColumnWidthPx,
  estimateCommercialDocsDynamicValueWidthPx,
  formatCommercialDocsDynamicCell,
  isCommercialDocsDynamicWidthColumn,
} from './commercialDocumentsColumns'
import { formatCommercialIdr, formatCommercialQtyKg } from './commercialDocumentsFormat'

describe('commercial documents dynamic column width', () => {
  it('applies only to Contract Qty, Unit Price, and Total Price', () => {
    expect(isCommercialDocsDynamicWidthColumn('contract_qty')).toBe(true)
    expect(isCommercialDocsDynamicWidthColumn('unit_price')).toBe(true)
    expect(isCommercialDocsDynamicWidthColumn('total_price')).toBe(true)
    expect(isCommercialDocsDynamicWidthColumn('supplier')).toBe(false)
    expect(isCommercialDocsDynamicWidthColumn('po_number')).toBe(false)
  })

  it('formats qty and money the same way as the table cells', () => {
    const row = {
      quantity_ordered: 1_234_567.89,
      unit_price: 12_500,
      total_price: 15_432_098_625,
      currency: 'IDR',
    }
    expect(formatCommercialDocsDynamicCell('contract_qty', row)).toBe(
      formatCommercialQtyKg(row.quantity_ordered),
    )
    expect(formatCommercialDocsDynamicCell('unit_price', row)).toBe(
      formatCommercialIdr(row.unit_price, row.currency),
    )
    expect(formatCommercialDocsDynamicCell('total_price', row)).toBe(
      formatCommercialIdr(row.total_price, row.currency),
    )
    expect(formatCommercialDocsDynamicCell('supplier', row)).toBe('')
  })

  it('grows past the header floor when the formatted value is longer', () => {
    const headerPx = commercialDocsTableColumnWidthPx('total_price', 'Total Price', {
      hasFormulaHelp: true,
    })
    const longValue = formatCommercialIdr(15_432_098_625, 'IDR')
    const dynamicPx = commercialDocsDynamicColumnWidthPx('total_price', 'Total Price', [longValue], {
      hasFormulaHelp: true,
    })
    expect(dynamicPx).toBeGreaterThan(headerPx)
    expect(dynamicPx).toBe(Math.max(headerPx, estimateCommercialDocsDynamicValueWidthPx(longValue)))
  })

  it('uses the longest sample among qty and unit price values', () => {
    const shortQty = formatCommercialQtyKg(10)
    const longQty = formatCommercialQtyKg(12_345_678.5)
    const qtyPx = commercialDocsDynamicColumnWidthPx('contract_qty', 'Contract Qty', [
      shortQty,
      longQty,
    ])
    expect(qtyPx).toBe(
      Math.max(
        commercialDocsTableColumnWidthPx('contract_qty', 'Contract Qty'),
        estimateCommercialDocsDynamicValueWidthPx(longQty),
      ),
    )

    const shortPrice = formatCommercialIdr(100, 'IDR')
    const longPrice = formatCommercialIdr(9_876_543, 'USD')
    const unitPx = commercialDocsDynamicColumnWidthPx('unit_price', 'Unit Price', [
      shortPrice,
      longPrice,
    ])
    expect(unitPx).toBe(
      Math.max(
        commercialDocsTableColumnWidthPx('unit_price', 'Unit Price'),
        estimateCommercialDocsDynamicValueWidthPx(longPrice),
      ),
    )
  })
})
