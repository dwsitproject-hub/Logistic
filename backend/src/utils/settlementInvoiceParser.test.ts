import { describe, expect, it } from 'vitest';
import {
  countExtractedFields,
  parseIndonesianAmount,
  parseSettlementInvoiceText,
  SETTLEMENT_INVOICE_FIELD_COUNT,
} from './settlementInvoiceParser';

describe('settlementInvoiceParser', () => {
  it('parses Indonesian Rupiah formats', () => {
    expect(parseIndonesianAmount('Rp. 1.234.567,89')).toBe(1234567.89);
    expect(parseIndonesianAmount('Rp 5000000')).toBe(5000000);
    expect(parseIndonesianAmount('1,234,567.50')).toBe(1234567.5);
  });

  it('extracts all settlement invoice labels from sample text', () => {
    const sample = `
      Jumlah Harga          Rp. 100.000.000,00
      Potongan Harga        Rp. 1.000.000,00
      Dikurangi Uang Muka   Rp. 10.000.000,00
      Jumlah                Rp. 89.000.000,00
      DPP Nilai Lain        Rp. 80.357.142,86
      PPN 12%               Rp. 9.642.857,14
      Jumlah yang Harus Dibayar Rp. 99.000.000,00
    `;
    const fields = parseSettlementInvoiceText(sample);
    expect(fields.gross_amount).toBe(100000000);
    expect(fields.discount_amount).toBe(1000000);
    expect(fields.down_payment).toBe(10000000);
    expect(fields.subtotal).toBe(89000000);
    expect(fields.tax_base_amount).toBeCloseTo(80357142.86, 0);
    expect(fields.vat_12_percent).toBeCloseTo(9642857.14, 0);
    expect(fields.total_payable).toBe(99000000);
    expect(countExtractedFields(fields)).toBe(SETTLEMENT_INVOICE_FIELD_COUNT);
  });

  it('returns nulls for missing fields without throwing', () => {
    const fields = parseSettlementInvoiceText('Invoice tanpa angka');
    expect(countExtractedFields(fields)).toBe(0);
    expect(fields.total_payable).toBeNull();
  });
});
