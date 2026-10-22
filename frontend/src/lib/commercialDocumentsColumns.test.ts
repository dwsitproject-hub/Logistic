import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_DOCS_ALL_COLUMNS,
  COMMERCIAL_DOCS_COLUMN_BY_ID,
  commercialDocsDynamicColumnWidthPx,
  commercialDocsTableColumnWidthPx,
  estimateCommercialDocsDynamicValueWidthPx,
  formatCommercialDocsDynamicCell,
  isCommercialDocsDynamicWidthColumn,
} from './commercialDocumentsColumns'
import { formatCommercialPriceCell, formatCommercialQtyCell } from './commercialDocumentsFormat'

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
      formatCommercialQtyCell(row.quantity_ordered),
    )
    expect(formatCommercialDocsDynamicCell('unit_price', row)).toBe(
      formatCommercialPriceCell(row.unit_price, row.currency),
    )
    expect(formatCommercialDocsDynamicCell('total_price', row)).toBe(
      formatCommercialPriceCell(row.total_price, row.currency),
    )
    expect(formatCommercialDocsDynamicCell('supplier', row)).toBe('')
  })

  it('grows past the header floor when the formatted value is longer', () => {
    const label = COMMERCIAL_DOCS_COLUMN_BY_ID.total_price.label
    const headerPx = commercialDocsTableColumnWidthPx('total_price', label, {
      hasFormulaHelp: true,
    })
    const longValue = formatCommercialPriceCell(15_432_098_625_000, 'IDR')
    const dynamicPx = commercialDocsDynamicColumnWidthPx('total_price', label, [longValue], {
      hasFormulaHelp: true,
    })
    expect(dynamicPx).toBeGreaterThan(headerPx)
    expect(dynamicPx).toBe(Math.max(headerPx, estimateCommercialDocsDynamicValueWidthPx(longValue)))
  })

  it('uses the longest sample among qty and unit price values', () => {
    const qtyLabel = COMMERCIAL_DOCS_COLUMN_BY_ID.contract_qty.label
    const shortQty = formatCommercialQtyCell(10)
    const longQty = formatCommercialQtyCell(12_345_678_901.5)
    const qtyPx = commercialDocsDynamicColumnWidthPx('contract_qty', qtyLabel, [shortQty, longQty])
    expect(qtyPx).toBe(
      Math.max(
        commercialDocsTableColumnWidthPx('contract_qty', qtyLabel),
        estimateCommercialDocsDynamicValueWidthPx(longQty),
      ),
    )

    const priceLabel = COMMERCIAL_DOCS_COLUMN_BY_ID.unit_price.label
    const shortPrice = formatCommercialPriceCell(100, 'IDR')
    const longPrice = formatCommercialPriceCell(9_876_543, 'USD')
    const unitPx = commercialDocsDynamicColumnWidthPx('unit_price', priceLabel, [shortPrice, longPrice])
    expect(unitPx).toBe(
      Math.max(
        commercialDocsTableColumnWidthPx('unit_price', priceLabel),
        estimateCommercialDocsDynamicValueWidthPx(longPrice),
      ),
    )
  })
})

describe('commercial documents qty / price columns carry their unit in the header', () => {
  it('labels the headers with the unit', () => {
    expect(COMMERCIAL_DOCS_COLUMN_BY_ID.contract_qty.label).toBe('Contract Qty (kg)')
    expect(COMMERCIAL_DOCS_COLUMN_BY_ID.unit_price.label).toBe('Unit Price (IDR)')
    expect(COMMERCIAL_DOCS_COLUMN_BY_ID.total_price.label).toBe('Total Price (IDR)')
  })

  it('shows the number only in the cell', () => {
    expect(formatCommercialQtyCell(300_000)).toBe('300,000')
    expect(formatCommercialPriceCell(12_400, 'IDR')).toBe('12,400')
    expect(formatCommercialPriceCell(3_720_000_000, 'IDR')).toBe('3,720,000,000')
    expect(formatCommercialPriceCell(12_400, null)).toBe('12,400')
    expect(formatCommercialPriceCell(12_400, '  idr ')).toBe('12,400')
  })

  it('keeps the currency on a row that is not in IDR, so the IDR header does not mislabel it', () => {
    expect(formatCommercialPriceCell(850, 'USD')).toBe('850 usd')
  })

  it('shows "-" for a price that is not a number (a null price still reads 0, as before)', () => {
    expect(formatCommercialPriceCell(undefined, 'IDR')).toBe('-')
    expect(formatCommercialPriceCell(Number.NaN, 'IDR')).toBe('-')
    expect(formatCommercialPriceCell(null, 'IDR')).toBe('0')
  })
})

describe('Sea/Land column', () => {
  it('is no longer a table column', () => {
    expect(COMMERCIAL_DOCS_ALL_COLUMNS.some((c) => (c.id as string) === 'transport_mode')).toBe(false)
    expect(COMMERCIAL_DOCS_ALL_COLUMNS.some((c) => c.label === 'Sea/Land')).toBe(false)
  })
})
