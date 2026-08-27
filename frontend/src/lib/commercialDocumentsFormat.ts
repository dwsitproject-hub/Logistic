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
