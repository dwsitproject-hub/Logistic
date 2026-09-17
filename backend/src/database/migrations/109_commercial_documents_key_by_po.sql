-- Commercial documents: key checklist / uploads / history by PO (keep contract_ext_no for audit + Tanda Terima).

ALTER TABLE commercial_document_files
  ADD COLUMN IF NOT EXISTS po_number TEXT;

ALTER TABLE commercial_document_history
  ADD COLUMN IF NOT EXISTS po_number TEXT;

ALTER TABLE settlement_invoice_summaries
  ADD COLUMN IF NOT EXISTS po_number TEXT;

-- Backfill files: match contracts.contract_id = stored contract_ext_no
UPDATE commercial_document_files f
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (f2.id)
    f2.id,
    NULLIF(TRIM(c.po_number), '') AS po_number
  FROM commercial_document_files f2
  INNER JOIN contracts c ON TRIM(BOTH FROM COALESCE(c.contract_id, '')) = TRIM(BOTH FROM COALESCE(f2.contract_ext_no, ''))
  WHERE NULLIF(TRIM(f2.po_number), '') IS NULL
    AND NULLIF(TRIM(c.po_number), '') IS NOT NULL
  ORDER BY f2.id, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
) sub
WHERE f.id = sub.id
  AND NULLIF(TRIM(f.po_number), '') IS NULL;

-- Backfill files: match SAP Contract Ext No
UPDATE commercial_document_files f
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (f2.id)
    f2.id,
    NULLIF(TRIM(c.po_number), '') AS po_number
  FROM commercial_document_files f2
  INNER JOIN contracts c ON TRUE
  INNER JOIN LATERAL (
    SELECT spd.data
    FROM sap_processed_data spd
    WHERE spd.contract_number = c.contract_id
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  ) latest_spd ON TRUE
  WHERE NULLIF(TRIM(f2.po_number), '') IS NULL
    AND NULLIF(TRIM(c.po_number), '') IS NOT NULL
    AND COALESCE(
      NULLIF(TRIM(latest_spd.data->'raw'->>'Contract Ext No'), ''),
      NULLIF(TRIM(latest_spd.data->>'Contract Ext No'), ''),
      c.contract_id
    ) = TRIM(BOTH FROM COALESCE(f2.contract_ext_no, ''))
  ORDER BY f2.id, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
) sub
WHERE f.id = sub.id
  AND NULLIF(TRIM(f.po_number), '') IS NULL;

-- History: copy from files where same contract_ext_no already has PO
UPDATE commercial_document_history h
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (h2.id)
    h2.id,
    NULLIF(TRIM(f.po_number), '') AS po_number
  FROM commercial_document_history h2
  INNER JOIN commercial_document_files f
    ON TRIM(BOTH FROM COALESCE(f.contract_ext_no, '')) = TRIM(BOTH FROM COALESCE(h2.contract_ext_no, ''))
   AND NULLIF(TRIM(f.po_number), '') IS NOT NULL
  WHERE NULLIF(TRIM(h2.po_number), '') IS NULL
  ORDER BY h2.id, f.updated_at DESC NULLS LAST, f.created_at DESC NULLS LAST
) sub
WHERE h.id = sub.id
  AND NULLIF(TRIM(h.po_number), '') IS NULL;

UPDATE commercial_document_history h
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (h2.id)
    h2.id,
    NULLIF(TRIM(c.po_number), '') AS po_number
  FROM commercial_document_history h2
  INNER JOIN contracts c ON TRIM(BOTH FROM COALESCE(c.contract_id, '')) = TRIM(BOTH FROM COALESCE(h2.contract_ext_no, ''))
  WHERE NULLIF(TRIM(h2.po_number), '') IS NULL
    AND NULLIF(TRIM(c.po_number), '') IS NOT NULL
  ORDER BY h2.id, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
) sub
WHERE h.id = sub.id
  AND NULLIF(TRIM(h.po_number), '') IS NULL;

UPDATE settlement_invoice_summaries s
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (s2.id)
    s2.id,
    NULLIF(TRIM(f.po_number), '') AS po_number
  FROM settlement_invoice_summaries s2
  INNER JOIN commercial_document_files f
    ON TRIM(BOTH FROM COALESCE(f.contract_ext_no, '')) = TRIM(BOTH FROM COALESCE(s2.contract_ext_no, ''))
   AND NULLIF(TRIM(f.po_number), '') IS NOT NULL
  WHERE NULLIF(TRIM(s2.po_number), '') IS NULL
  ORDER BY s2.id, f.updated_at DESC NULLS LAST
) sub
WHERE s.id = sub.id
  AND NULLIF(TRIM(s.po_number), '') IS NULL;

UPDATE settlement_invoice_summaries s
SET po_number = sub.po_number
FROM (
  SELECT DISTINCT ON (s2.id)
    s2.id,
    NULLIF(TRIM(c.po_number), '') AS po_number
  FROM settlement_invoice_summaries s2
  INNER JOIN contracts c ON TRIM(BOTH FROM COALESCE(c.contract_id, '')) = TRIM(BOTH FROM COALESCE(s2.contract_ext_no, ''))
  WHERE NULLIF(TRIM(s2.po_number), '') IS NULL
    AND NULLIF(TRIM(c.po_number), '') IS NOT NULL
  ORDER BY s2.id, c.updated_at DESC NULLS LAST
) sub
WHERE s.id = sub.id
  AND NULLIF(TRIM(s.po_number), '') IS NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_document_files_po
  ON commercial_document_files (po_number);

CREATE INDEX IF NOT EXISTS idx_commercial_document_files_po_type_created
  ON commercial_document_files (po_number, document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_document_history_po_created
  ON commercial_document_history (po_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_invoice_summaries_po
  ON settlement_invoice_summaries (po_number);

-- Prefer UNIQUE by PO for new settlement upserts (ext-no unique was previous design)
ALTER TABLE settlement_invoice_summaries
  DROP CONSTRAINT IF EXISTS settlement_invoice_summaries_contract_ext_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS settlement_invoice_summaries_po_number_uidx
  ON settlement_invoice_summaries (po_number)
  WHERE NULLIF(TRIM(po_number), '') IS NOT NULL;
