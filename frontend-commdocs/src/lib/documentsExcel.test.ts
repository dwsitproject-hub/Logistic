import { describe, expect, it } from 'vitest'
import { DOCUMENT_TYPES } from './documentTypes'
import { EXPORT_COLUMNS } from './documentsExcel'
import type { DocumentRow } from './types'

const row = {
  po_number: '1001', contract_ext_no: 'X-1', contract_date: '2026-07-23T00:00:00.000Z', quantity_ordered: 1500.5, unit_price: 12000, total_price: 18006000,
  currency: null, payment_due_date: null, dp_due_date: null, payoff_date: '2026-08-01', doc_contract: true, doc_sppb: true,
} as unknown as DocumentRow

const get = (header: string) => EXPORT_COLUMNS.find((c) => c.header === header)!.value(row)

describe('documents Excel export', () => {
  it('carries every table column, hidden ones included, plus one column per document type', () => {
    const headers = EXPORT_COLUMNS.map((c) => c.header)
    for (const h of ['Buyer', 'Payment Due Date', 'DP Date', 'Payoff Date', 'Unit Price (IDR)', 'Total Price (IDR)', 'B2B', 'Status']) expect(headers).toContain(h)
    expect(DOCUMENT_TYPES.every((t) => headers.some((h) => h.length > 0))).toBe(true)
    expect(headers).toContain('SPPB')
  })
  it('keeps units in the header and values as numbers', () => {
    expect(get('Contract Qty (kg)')).toBe(1500.5)
    expect(get('Unit Price (IDR)')).toBe(12000)
    expect(get('Total Price (IDR)')).toBe(18006000)
    expect(get('Currency')).toBe('IDR')
  })
  it('writes dates as real dates on the same calendar day, blank when missing', () => {
    expect((get('Contract Date') as Date).toISOString().slice(0, 10)).toBe('2026-07-23')
    expect(get('Payment Due Date')).toBeNull()
  })
  it('writes each document type as 1 or 0, so it can be summed', () => {
    expect(get('SPPB')).toBe(1)
    expect(get('SPPD')).toBe(0)
    expect(get('Documents Uploaded')).toBe(2)
  })
})
