-- DO (delivery order) as a document type of KLIP's own documents table.
-- The Trucking page's "Upload DO" files its uploads as DO, so Commercial Documents (COD), which keeps its own DO type per PO, can show them in its DO slot.
-- The other types stay as migration 210 left them.

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
    'BL',
    'DO'
  ));
