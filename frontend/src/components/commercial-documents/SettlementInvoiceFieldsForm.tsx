'use client'

import { Input } from '@/components/ui/input'
import {
  SETTLEMENT_INVOICE_FIELD_META,
  type SettlementInvoiceFieldKey,
  type SettlementInvoiceFields,
} from '@/lib/settlementInvoiceTypes'

type Props = {
  values: SettlementInvoiceFields
  onChange: (key: SettlementInvoiceFieldKey, value: number | null) => void
  disabled?: boolean
}

export function SettlementInvoiceFieldsForm({ values, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {SETTLEMENT_INVOICE_FIELD_META.map(({ key, label, indonesianLabel }) => (
        <div key={key}>
          <label className="text-xs text-gray-500 block">
            {label}
            <span className="text-gray-400 font-normal"> ({indonesianLabel})</span>
          </label>
          <Input
            type="text"
            inputMode="decimal"
            className="h-8 text-sm mt-1"
            disabled={disabled}
            placeholder="0"
            value={
              values[key] !== null && values[key] !== undefined && Number.isFinite(values[key])
                ? String(values[key])
                : ''
            }
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.,-]/g, '')
              if (!raw.trim()) {
                onChange(key, null)
                return
              }
              const normalized = raw.replace(/\./g, '').replace(',', '.')
              const n = Number.parseFloat(normalized)
              onChange(key, Number.isFinite(n) ? n : null)
            }}
          />
        </div>
      ))}
    </div>
  )
}
