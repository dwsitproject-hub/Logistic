-- Commercial Documents: Berita Acara (BA), listed right after Addendum Contract.
-- The constraint is rebuilt with every value of migration 175 plus 'berita_acara'; nothing is removed.

ALTER TABLE commercial_document_files
  DROP CONSTRAINT IF EXISTS commercial_document_files_document_type_check;

ALTER TABLE commercial_document_files
  ADD CONSTRAINT commercial_document_files_document_type_check CHECK (
    document_type IN (
      'draft_contract',
      'contract',
      'addendum_contract',
      'berita_acara',
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
