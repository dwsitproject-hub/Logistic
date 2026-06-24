-- Commercial Documents: allow multiple file versions per type + new document type codes

ALTER TABLE commercial_document_files
  DROP CONSTRAINT IF EXISTS commercial_document_files_contract_ext_no_document_type_key;

ALTER TABLE commercial_document_files
  DROP CONSTRAINT IF EXISTS commercial_document_files_document_type_check;

ALTER TABLE commercial_document_files
  ADD CONSTRAINT commercial_document_files_document_type_check CHECK (
    document_type IN (
      'contract',
      'addendum_contract',
      'invoice_fp_dp',
      'invoice_fp_payoff',
      'invoice_fp_full',
      -- legacy (backward compatibility)
      'faktur_pajak',
      'dp',
      'invoice_dp',
      'ep_pelunasan',
      'invoice_pelunasan'
    )
  );

CREATE INDEX IF NOT EXISTS idx_commercial_document_files_ext_type_created
  ON commercial_document_files (contract_ext_no, document_type, created_at DESC);
