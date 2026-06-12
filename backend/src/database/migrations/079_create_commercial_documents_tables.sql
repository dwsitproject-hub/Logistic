-- Commercial Documents — upload status + audit trail (keyed by contract_ext_no)

CREATE TABLE IF NOT EXISTS commercial_document_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_ext_no TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (
    document_type IN (
      'contract',
      'faktur_pajak',
      'dp',
      'invoice_dp',
      'ep_pelunasan',
      'invoice_pelunasan'
    )
  ),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT DEFAULT 'application/pdf',
  checked BOOLEAN NOT NULL DEFAULT true,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contract_ext_no, document_type)
);

CREATE INDEX IF NOT EXISTS idx_commercial_document_files_ext_no
  ON commercial_document_files (contract_ext_no);

CREATE TABLE IF NOT EXISTS commercial_document_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_ext_no TEXT NOT NULL,
  document_type TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('ADD', 'EDIT')),
  file_path TEXT,
  file_name TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commercial_document_history_ext_no
  ON commercial_document_history (contract_ext_no, created_at DESC);
