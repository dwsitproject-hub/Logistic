-- Commercial Documents: Draft Contract, Bea Cukai, DO

ALTER TABLE commercial_document_files
  DROP CONSTRAINT IF EXISTS commercial_document_files_document_type_check;

ALTER TABLE commercial_document_files
  ADD CONSTRAINT commercial_document_files_document_type_check CHECK (
    document_type IN (
      'draft_contract',
      'contract',
      'addendum_contract',
      'bea_cukai',
      'delivery_order',
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
