/**
 * The Delivery Order (DO) files uploaded in KLIP (Trucking > Upload DO), seen from a PO in Commercial Documents (COD).
 *
 * KLIP files a Trucking upload as documents.document_type = 'DO' (KLIP migration 274). The row hangs on the trucking operation (documents.trucking_operation_id,
 * reaching the PO through trucking_operations.contract_id) or, for a backlog row that has no operation yet, straight on the contract (documents.contract_id). The same
 * two ways KLIP's own document list finds a contract's files (document.controller.ts). The PO is contracts.po_number, or the contract number when SAP sent none:
 * the key the COD list uses.
 *
 * Ryan decided (2026-11-27) that such a file fills the DO slot of the PO: a PO has a DO when COD holds one OR KLIP holds a non-deleted 'DO' document. Read only: COD
 * neither uploads nor deletes these. Older Trucking uploads typed 'OTHER' stay out until Ryan decides to reclassify them.
 *
 * Columns read from KLIP's tables (kept stable by KLIP): documents.id, document_type, file_name, file_size, mime_type, upload_date, uploaded_by, deleted_at,
 * trucking_operation_id, contract_id; trucking_operations.id, contract_id; contracts.id, po_number, contract_id.
 */

/**
 * The contracts that have at least one KLIP DO: a CTE body for the COD list, joined on contracts.id to set the DO flag of a PO. Starts from the documents of type DO (a
 * handful), never from the 10k contracts.
 */
export const COMMERCIAL_KLIP_DO_CONTRACTS_SQL = `
      SELECT d.contract_id AS contract_id
        FROM documents d
       WHERE d.document_type = 'DO' AND d.deleted_at IS NULL AND d.contract_id IS NOT NULL
      UNION
      SELECT t.contract_id
        FROM documents d
        JOIN trucking_operations t ON t.id = d.trucking_operation_id
       WHERE d.document_type = 'DO' AND d.deleted_at IS NULL AND t.contract_id IS NOT NULL`;

/** $1 = the PO number as the COD list shows it (or the contract id when SAP sent no PO). Newest file first. */
export const COMMERCIAL_KLIP_DO_FILES_SQL = `
  WITH po AS (
    SELECT c.id
      FROM contracts c
     WHERE NULLIF(TRIM(c.po_number), '') = $1 OR TRIM(c.contract_id) = $1
  )
  SELECT
    d.id::text AS id,
    d.file_name,
    d.file_size,
    d.mime_type,
    d.upload_date,
    COALESCE(NULLIF(TRIM(uu.username), ''), NULLIF(TRIM(au.username), '')) AS uploaded_by_name
  FROM documents d
  LEFT JOIN trucking_operations t ON t.id = d.trucking_operation_id
  LEFT JOIN users uu ON uu.id = d.uploaded_by
  -- Older uploads have no documents.uploaded_by: the audit entry of the upload holds the user. audit_logs has no index on entity_id, so the lookup is bounded by the
  -- upload time (indexed column) around the document's upload_date.
  LEFT JOIN LATERAL (
    SELECT u3.username
      FROM audit_logs al
      JOIN users u3 ON u3.id = al.user_id
     WHERE al.entity_id = d.id
       AND al.entity_type = 'DOCUMENT'
       AND al.action = 'CREATE'
       AND al."timestamp" >= d.upload_date - INTERVAL '2 minutes'
       AND al."timestamp" <= d.upload_date + INTERVAL '10 minutes'
     ORDER BY al."timestamp"
     LIMIT 1
  ) au ON d.uploaded_by IS NULL
  WHERE d.document_type = 'DO'
    AND d.deleted_at IS NULL
    AND (d.contract_id IN (SELECT id FROM po) OR t.contract_id IN (SELECT id FROM po))
  ORDER BY d.upload_date DESC NULLS LAST, d.id
`;

export type KlipDoRow = {
  id: string;
  file_name: string;
  file_size: string | number | null;
  mime_type: string | null;
  upload_date: Date | string | null;
  uploaded_by_name?: string | null;
};

export type KlipDoFile = {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  mimeType: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
};

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The rows of the query as files, in the query's order (newest first). */
export function klipDoFiles(rows: KlipDoRow[]): KlipDoFile[] {
  return rows.map((r) => {
    const size = r.file_size == null ? null : Number(r.file_size);
    return {
      id: r.id,
      fileName: r.file_name,
      sizeBytes: size != null && Number.isFinite(size) ? size : null,
      mimeType: r.mime_type,
      uploadedAt: iso(r.upload_date),
      uploadedBy: String(r.uploaded_by_name || '').trim() || null,
    };
  });
}

/** One History entry of the PO drawer for a DO uploaded in KLIP: ADD, badged "via KLIP" by the frontend, under the DO type like a COD upload. */
export type KlipDoHistoryEntry = {
  id: string;
  document_type: 'delivery_order';
  document_type_label: string;
  action_type: 'ADD';
  file_name: string;
  user_name: string | null;
  created_at: string;
  source: 'KLIP';
};

export function klipDoAsHistory(files: KlipDoFile[], label: string): KlipDoHistoryEntry[] {
  return files
    .filter((f) => f.uploadedAt)
    .map((f) => ({
      id: `klip-do-${f.id}`,
      document_type: 'delivery_order' as const,
      document_type_label: label,
      action_type: 'ADD' as const,
      file_name: f.fileName,
      user_name: f.uploadedBy,
      created_at: f.uploadedAt as string,
      source: 'KLIP' as const,
    }));
}
