-- Settlement Invoice (Invoice Pelunasan) OCR-extracted financial summary per contract.

CREATE TABLE IF NOT EXISTS settlement_invoice_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_ext_no TEXT NOT NULL,
  commercial_document_file_id UUID REFERENCES commercial_document_files(id) ON DELETE SET NULL,
  contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  gross_amount NUMERIC(18, 2),
  discount_amount NUMERIC(18, 2),
  down_payment NUMERIC(18, 2),
  subtotal NUMERIC(18, 2),
  tax_base_amount NUMERIC(18, 2),
  vat_12_percent NUMERIC(18, 2),
  total_payable NUMERIC(18, 2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contract_ext_no)
);

CREATE INDEX IF NOT EXISTS idx_settlement_invoice_summaries_ext_no
  ON settlement_invoice_summaries (contract_ext_no);

CREATE INDEX IF NOT EXISTS idx_settlement_invoice_summaries_file_id
  ON settlement_invoice_summaries (commercial_document_file_id);
