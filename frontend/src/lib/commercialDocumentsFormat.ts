import { formatDateDMY } from '@/lib/dateFormat'
import type { CommercialDocumentRow } from '@/lib/commercialDocumentsTypes'

export function formatCommercialQtyKg(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`
}

export function formatCommercialIdr(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} idr`
}

export const COMMERCIAL_TOTAL_PRICE_FORMULA_HELP =
  'Formula: Contract Qty × Unit Price'

export function commercialTotalPriceTooltip(
  row: Pick<CommercialDocumentRow, 'quantity_ordered' | 'unit_price'>,
): string {
  const qty = Number(row.quantity_ordered) || 0
  const price = Number(row.unit_price) || 0
  return `Formula: Contract Qty (${qty.toLocaleString('en-US')} kg) × Unit Price (${price.toLocaleString('en-US')} idr)`
}

export function formatCommercialDate(value: string | null | undefined): string {
  return formatDateDMY(value)
}
