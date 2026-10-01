-- Contract, SI, and BL are the shipment documents Edit Shipment uploads.
-- JPS receives only their download URLs; the files stay on the Synology share.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_document_type_check;

ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (
    'BOL',
    'INVOICE',
    'SURVEY',
    'COA',
    'PAYMENT_PROOF',
    'OTHER',
    'QUANTITY_ADJUSTMENT',
    'SLD',
    'SDD',
    'CONTRACT',
    'SI',
    'BL'
  ));
