-- Migration 083: Allow SLD and SDD shipment document types (quantity edit authorization)

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
    'SDD'
  ));
