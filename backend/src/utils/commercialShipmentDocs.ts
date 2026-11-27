/**
 * The Shipment Docs card of Commercial Documents (COD): the BL and SI files that were uploaded in KLIP (Shipments > Edit Shipment), seen from a PO.
 *
 * COD keys everything by PO, KLIP by shipment row: a document hangs on ONE shipment row (documents.shipment_id), the row the Edit Shipment modal was opened on.
 * A PO reaches shipment rows the same three ways the modal finds the POs of a shipment (services/shipmentEditContext.service.ts):
 *   - its own shipment rows (shipments.contract_id);
 *   - a shipment whose numeric shipment_id is one of its STOs (contract_stos);
 *   - the other shipments of the same operation (operation_id): a voyage that carries several POs has one shipment row per PO and the files hang on one of them.
 * Measured on production 2026-11-27 (73 SI/BL files): the own rows reach all files but only from 43 POs; the operation link adds 37 POs that would otherwise not see
 * the BL/SI of their own voyage; 39 files show under more than one PO (up to 7), 19 POs have files from more than one voyage.
 *
 * Contract documents are left out on purpose (COD has its own Contract card), and so are deleted files and those of CANCELLED shipments. Read-only: COD
 * neither uploads nor deletes these; that stays in KLIP.
 */

export const COMMERCIAL_SHIPMENT_DOC_TYPES = ['SI', 'BL'] as const;

/** $1 = the PO number as the COD list shows it (or the contract id when SAP sent no PO). */
export const COMMERCIAL_SHIPMENT_DOCS_SQL = `
  WITH po AS (
    SELECT c.id
      FROM contracts c
     WHERE NULLIF(TRIM(c.po_number), '') = $1 OR TRIM(c.contract_id) = $1
  ),
  linked AS (
    SELECT s.id AS shipment_uuid
      FROM shipments s
     WHERE s.contract_id IN (SELECT id FROM po)
    UNION
    SELECT s.id
      FROM shipments s
      JOIN contract_stos cs ON TRIM(cs.sto_number::text) = TRIM(s.shipment_id::text)
     WHERE cs.contract_id IN (SELECT id FROM po)
       AND TRIM(COALESCE(s.shipment_id::text, '')) ~ '^[0-9]+$'
    UNION
    SELECT s2.id
      FROM shipments s1
      JOIN shipments s2 ON NULLIF(TRIM(s2.operation_id::text), '') = NULLIF(TRIM(s1.operation_id::text), '')
     WHERE s1.contract_id IN (SELECT id FROM po)
       AND NULLIF(TRIM(s1.operation_id::text), '') IS NOT NULL
  )
  SELECT
    d.id::text AS id,
    d.document_type,
    d.file_name,
    d.file_size,
    d.mime_type,
    d.upload_date,
    COALESCE(NULLIF(TRIM(uu.username), ''), NULLIF(TRIM(au.username), '')) AS uploaded_by_name,
    s.id::text AS shipment_uuid,
    s.shipment_id AS shipment_no,
    s.operation_id,
    s.vessel_name,
    s.voyage_no,
    COALESCE(s.ata_arrival, s.eta_arrival) AS shipment_date,
    sh.other_pos
  FROM linked l
  JOIN shipments s ON s.id = l.shipment_uuid
  JOIN documents d ON d.shipment_id = s.id
  LEFT JOIN users uu ON uu.id = d.uploaded_by
  -- KLIP's upload does not fill documents.uploaded_by; the audit entry of the upload (middleware auditLog CREATE DOCUMENT) holds the user. audit_logs has no index on
  -- entity_id, so the lookup is bounded by the upload time (indexed column) around the document's upload_date.
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
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c2.po_number ORDER BY c2.po_number) AS other_pos
      FROM (
        SELECT s.contract_id AS cid
        UNION
        SELECT cs2.contract_id
          FROM contract_stos cs2
         WHERE TRIM(cs2.sto_number::text) = TRIM(COALESCE(s.shipment_id::text, ''))
           AND TRIM(COALESCE(s.shipment_id::text, '')) ~ '^[0-9]+$'
        UNION
        SELECT s3.contract_id
          FROM shipments s3
         WHERE NULLIF(TRIM(s3.operation_id::text), '') = NULLIF(TRIM(s.operation_id::text), '')
           AND NULLIF(TRIM(s.operation_id::text), '') IS NOT NULL
      ) x
      JOIN contracts c2 ON c2.id = x.cid
     WHERE c2.id NOT IN (SELECT id FROM po)
       AND NULLIF(TRIM(c2.po_number), '') IS NOT NULL
  ) sh ON TRUE
  WHERE d.deleted_at IS NULL
    AND d.document_type IN ('SI', 'BL')
    AND COALESCE(s.status, '') <> 'CANCELLED'
  ORDER BY COALESCE(s.ata_arrival, s.eta_arrival) DESC NULLS LAST, s.created_at DESC, s.id, d.document_type, d.upload_date DESC
`;

export type ShipmentDocRow = {
  id: string;
  document_type: string;
  file_name: string;
  file_size: string | number | null;
  mime_type: string | null;
  upload_date: Date | string | null;
  uploaded_by_name?: string | null;
  shipment_uuid: string;
  shipment_no: string | null;
  operation_id: string | null;
  vessel_name: string | null;
  voyage_no: string | null;
  shipment_date: Date | string | null;
  other_pos: string[] | null;
};

export type ShipmentDocGroup = {
  shipmentId: string;
  /** The STO (numeric shipment id) or the operation id the voyage is known by. */
  reference: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  /** ATA at the loading side when known, else the ETA: the date shown beside the vessel. */
  date: string | null;
  /** The other POs of this voyage (their own PO numbers): the files are the voyage's, so they show under each of them. */
  sharedWithPos: string[];
  documents: Array<{ id: string; type: 'SI' | 'BL'; fileName: string; sizeBytes: number | null; mimeType: string | null; uploadedAt: string | null; uploadedBy: string | null }>;
};

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** One group per shipment row, in the query's order (newest voyage first); inside a group BL before SI, newest file first. */
export function groupShipmentDocs(rows: ShipmentDocRow[]): ShipmentDocGroup[] {
  const groups = new Map<string, ShipmentDocGroup>();
  for (const r of rows) {
    const type = String(r.document_type || '').toUpperCase();
    if (type !== 'SI' && type !== 'BL') continue;
    let g = groups.get(r.shipment_uuid);
    if (!g) {
      const date = iso(r.shipment_date);
      g = {
        shipmentId: r.shipment_uuid,
        reference: String(r.shipment_no || r.operation_id || '').trim() || null,
        vesselName: String(r.vessel_name || '').trim() || null,
        voyageNo: String(r.voyage_no || '').trim() || null,
        date: date ? date.slice(0, 10) : null,
        sharedWithPos: Array.isArray(r.other_pos) ? r.other_pos.map((p) => String(p).trim()).filter(Boolean) : [],
        documents: [],
      };
      groups.set(r.shipment_uuid, g);
    }
    const size = r.file_size == null ? null : Number(r.file_size);
    g.documents.push({
      id: r.id,
      type,
      fileName: r.file_name,
      sizeBytes: size != null && Number.isFinite(size) ? size : null,
      mimeType: r.mime_type,
      uploadedAt: iso(r.upload_date),
      uploadedBy: String(r.uploaded_by_name || '').trim() || null,
    });
  }
  for (const g of groups.values()) {
    g.documents.sort((a, b) => (a.type === b.type ? String(b.uploadedAt).localeCompare(String(a.uploadedAt)) : a.type === 'BL' ? -1 : 1));
  }
  return [...groups.values()];
}

/** One History entry of the PO drawer for a file uploaded in KLIP: always ADD (from the document's own row), badged "via KLIP" by the frontend. */
export type ShipmentDocHistoryEntry = {
  id: string;
  document_type: 'shipment_docs';
  document_type_label: string;
  action_type: 'ADD';
  file_name: string;
  user_name: string | null;
  created_at: string;
  source: 'KLIP';
};

/** KLIP uploads as History entries (BL / SI), so the tab shows them next to the COD uploads; newest first. */
export function shipmentDocsAsHistory(groups: ShipmentDocGroup[]): ShipmentDocHistoryEntry[] {
  const out: ShipmentDocHistoryEntry[] = [];
  for (const g of groups) {
    for (const d of g.documents) {
      if (!d.uploadedAt) continue;
      out.push({
        id: `klip-${d.id}`,
        document_type: 'shipment_docs',
        document_type_label: `Shipment Docs · ${d.type}`,
        action_type: 'ADD',
        file_name: d.fileName,
        user_name: d.uploadedBy,
        created_at: d.uploadedAt,
        source: 'KLIP',
      });
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
