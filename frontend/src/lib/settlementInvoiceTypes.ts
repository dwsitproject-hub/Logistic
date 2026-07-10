export interface SettlementInvoiceFields {
  gross_amount: number | null
  discount_amount: number | null
  down_payment: number | null
  subtotal: number | null
  tax_base_amount: number | null
  vat_12_percent: number | null
  total_payable: number | null
}

export type SettlementInvoiceFieldKey = keyof SettlementInvoiceFields

export const SETTLEMENT_INVOICE_FIELD_META: {
  key: SettlementInvoiceFieldKey
  label: string
  indonesianLabel: string
}[] = [
  { key: 'gross_amount', label: 'Gross Amount', indonesianLabel: 'Jumlah Harga' },
  { key: 'discount_amount', label: 'Discount Amount', indonesianLabel: 'Potongan Harga' },
  { key: 'down_payment', label: 'Down Payment', indonesianLabel: 'Dikurangi Uang Muka' },
  { key: 'subtotal', label: 'Subtotal', indonesianLabel: 'Jumlah' },
  { key: 'tax_base_amount', label: 'Tax Base Amount', indonesianLabel: 'DPP Nilai Lain' },
  { key: 'vat_12_percent', label: 'VAT 12%', indonesianLabel: 'PPN 12%' },
  { key: 'total_payable', label: 'Total Payable', indonesianLabel: 'Jumlah yang Harus Dibayar' },
]

export const EMPTY_SETTLEMENT_INVOICE_FIELDS: SettlementInvoiceFields = {
  gross_amount: null,
  discount_amount: null,
  down_payment: null,
  subtotal: null,
  tax_base_amount: null,
  vat_12_percent: null,
  total_payable: null,
}

export function settlementFieldsFromApi(data: Record<string, unknown> | null | undefined): SettlementInvoiceFields {
  if (!data) return { ...EMPTY_SETTLEMENT_INVOICE_FIELDS }
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    gross_amount: num(data.gross_amount),
    discount_amount: num(data.discount_amount),
    down_payment: num(data.down_payment),
    subtotal: num(data.subtotal),
    tax_base_amount: num(data.tax_base_amount),
    vat_12_percent: num(data.vat_12_percent),
    total_payable: num(data.total_payable),
  }
}

export function parseSettlementFieldInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

export function formatSettlementFieldInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(value)
}
