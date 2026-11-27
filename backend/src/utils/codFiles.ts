/**
 * Files that were uploaded in Commercial Documents (COD), seen from KLIP (read only).
 *
 * COD keeps one row per uploaded VERSION in commercial_document_files, keyed by PO (po_number) and type; a new upload of the same type is a new row, a delete removes the row.
 * KLIP shows them next to its own documents (Edit Shipment, the Trucking DO dialog) and the Jetty email / JPS link can fall back on them. Everything the pages and the email
 * need to decide - which version is the latest, which Contract of which PO is used - is a pure function here, so the rules are tested without a database.
 */

/** The COD types KLIP reads. The same keys COD stores (migrations 089 / 175): the KLIP-facing endpoint never serves the invoices and tax documents that share the table. */
export const COD_FILE_TYPES = ['contract', 'addendum_contract', 'delivery_order'] as const;
export type CodFileType = (typeof COD_FILE_TYPES)[number];

export function isCodFileType(value: unknown): value is CodFileType {
  return typeof value === 'string' && (COD_FILE_TYPES as readonly string[]).includes(value);
}

/** $1 = PO keys (the PO number as COD shows it, or the contract id when SAP sent no PO), $2 = COD types. Newest version first inside a PO and type. */
export const COD_FILES_SQL = `
  SELECT f.id::text AS id,
         f.po_number,
         f.document_type,
         f.file_name,
         f.file_size,
         f.mime_type,
         f.created_at,
         COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(u.username), '')) AS uploaded_by_name
    FROM commercial_document_files f
    LEFT JOIN users u ON u.id = f.uploaded_by
   WHERE f.po_number = ANY($1::text[])
     AND f.document_type = ANY($2::text[])
   ORDER BY f.po_number, f.document_type, f.created_at DESC
`;

export type CodFileRow = {
  id: string;
  po_number: string | null;
  document_type: string;
  file_name: string;
  file_size: string | number | null;
  mime_type: string | null;
  created_at: Date | string | null;
  uploaded_by_name?: string | null;
};

export type CodFileVersion = {
  id: string;
  /** 1 = the oldest version still in COD. A deleted version in the middle renumbers the ones after it: the number only orders what exists. */
  version: number;
  fileName: string;
  sizeBytes: number | null;
  mimeType: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  isLatest: boolean;
};

export type CodFileGroup = {
  poNumber: string;
  type: CodFileType;
  /** Newest first: versions[0] is the latest, the one a page shows by default and the one JPS / the email use. */
  versions: CodFileVersion[];
};

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const time = (v: string | null): number => (v ? new Date(v).getTime() : 0);

/**
 * One group per PO and type, in the order of the first file seen; the versions inside are re-sorted newest first here (the SQL order is not trusted), and numbered 1..n from the
 * oldest. Rows of a type KLIP does not read, or with no PO, are left out.
 */
export function groupCodFiles(rows: CodFileRow[]): CodFileGroup[] {
  const groups = new Map<string, CodFileGroup>();
  for (const r of rows) {
    const po = String(r.po_number ?? '').trim();
    if (!po || !isCodFileType(r.document_type)) continue;
    const key = `${po}\u0000${r.document_type}`;
    let g = groups.get(key);
    if (!g) {
      g = { poNumber: po, type: r.document_type, versions: [] };
      groups.set(key, g);
    }
    const size = r.file_size == null ? null : Number(r.file_size);
    g.versions.push({
      id: r.id,
      version: 0,
      fileName: r.file_name,
      sizeBytes: size != null && Number.isFinite(size) ? size : null,
      mimeType: r.mime_type,
      uploadedAt: iso(r.created_at),
      uploadedBy: String(r.uploaded_by_name ?? '').trim() || null,
      isLatest: false,
    });
  }
  for (const g of groups.values()) {
    g.versions.sort((a, b) => time(b.uploadedAt) - time(a.uploadedAt));
    const n = g.versions.length;
    g.versions.forEach((v, i) => {
      v.version = n - i;
      v.isLatest = i === 0;
    });
  }
  return [...groups.values()];
}

/** The latest version of every PO's Contract, in the order of `poKeys` (a PO with no Contract in COD is simply absent). */
export function latestCodContracts(groups: CodFileGroup[], poKeys: string[]): Array<{ poNumber: string; version: CodFileVersion }> {
  const out: Array<{ poNumber: string; version: CodFileVersion }> = [];
  for (const po of poKeys) {
    const g = groups.find((x) => x.poNumber === po && x.type === 'contract');
    if (g && g.versions[0]) out.push({ poNumber: po, version: g.versions[0] });
  }
  return out;
}
