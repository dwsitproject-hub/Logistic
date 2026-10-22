import { formatDateDMY } from '@/lib/dateFormat'
import type { CommercialDocumentRow } from '@/lib/commercialDocumentsTypes'

export function formatCommercialQtyKg(value: number | null | undefined): string {
  const n = Number(value)
  const qty = Number.isFinite(n) ? n : 0
  return `${qty.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`
}

export function formatCommercialIdr(
  value: number | null | undefined,
  currency?: string | null,
): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const suffix = (currency && String(currency).trim()) || 'IDR'
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${suffix.toLowerCase()}`
}

/** Contract Qty table cell: the number only - the "(kg)" unit is in the column header. */
export function formatCommercialQtyCell(value: number | null | undefined): string {
  const n = Number(value)
  const qty = Number.isFinite(n) ? n : 0
  return qty.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** The currency the Unit Price / Total Price column headers are labelled with. */
export const COMMERCIAL_TABLE_CURRENCY = 'IDR'

/**
 * Unit Price / Total Price table cell: the number only for the header's currency (IDR, or none on the row, which the page treats as IDR).
 * A row in another currency keeps its code after the number, since the "(IDR)" in the header would otherwise mislabel it.
 */
export function formatCommercialPriceCell(
  value: number | null | undefined,
  currency?: string | null,
): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const formatted = n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const cur = ((currency && String(currency).trim()) || COMMERCIAL_TABLE_CURRENCY).toUpperCase()
  return cur === COMMERCIAL_TABLE_CURRENCY ? formatted : `${formatted} ${cur.toLowerCase()}`
}

/** A SAP amount as SAP has it (no currency is sent with it): '-' when there is none, 0 stays 0. */
export function formatCommercialSapAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export const COMMERCIAL_TOTAL_PRICE_FORMULA_HELP =
  'Formula: Contract Qty × Unit Price'

export function commercialTotalPriceTooltip(
  row: Pick<CommercialDocumentRow, 'quantity_ordered' | 'unit_price' | 'currency'>,
): string {
  const qty = Number(row.quantity_ordered) || 0
  const price = Number(row.unit_price) || 0
  const cur = (row.currency && String(row.currency).trim()) || 'IDR'
  return `Formula: Contract Qty (${qty.toLocaleString('en-US')} kg) × Unit Price (${price.toLocaleString('en-US')} ${cur.toLowerCase()})`
}

export function formatCommercialDate(value: string | null | undefined): string {
  return formatDateDMY(value)
}
