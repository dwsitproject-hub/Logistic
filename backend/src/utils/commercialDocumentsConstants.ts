export const COMMERCIAL_DOCUMENT_TYPES = [
  'draft_contract',
  'contract',
  'addendum_contract',
  'bea_cukai',
  'delivery_order',
  'invoice_fp_dp',
  'invoice_fp_payoff',
  'invoice_fp_full',
] as const;

export type CommercialDocumentType = (typeof COMMERCIAL_DOCUMENT_TYPES)[number];

/** Legacy DB values kept for backward-compatible checklist + history. */
export const LEGACY_COMMERCIAL_DOCUMENT_TYPES = [
  'faktur_pajak',
  'dp',
  'invoice_dp',
  'ep_pelunasan',
  'invoice_pelunasan',
] as const;

export type LegacyCommercialDocumentType = (typeof LEGACY_COMMERCIAL_DOCUMENT_TYPES)[number];

export type AnyCommercialDocumentType = CommercialDocumentType | LegacyCommercialDocumentType;

export const COMMERCIAL_DOCUMENT_TYPE_LABELS: Record<CommercialDocumentType, string> = {
  draft_contract: 'Draft Contract',
  contract: 'Contract',
  addendum_contract: 'Addendum Contract',
  bea_cukai: 'Bea Cukai',
  delivery_order: 'DO',
  invoice_fp_dp: 'Invoice + FP Down Payment (DP)',
  invoice_fp_payoff: 'Invoice + FP Payoff (PO)',
  invoice_fp_full: 'Invoice + FP (Full Receive)',
};

export const LEGACY_COMMERCIAL_DOCUMENT_TYPE_LABELS: Record<LegacyCommercialDocumentType, string> = {
  faktur_pajak: 'Faktur Pajak',
  dp: 'DP',
  invoice_dp: 'Invoice DP',
  ep_pelunasan: 'EP Pelunasan',
  invoice_pelunasan: 'Invoice Pelunasan',
};

export const COMMERCIAL_DOCUMENT_FILENAME_CODES: Record<CommercialDocumentType, string> = {
  draft_contract: 'Dctr',
  contract: 'Ctr',
  addendum_contract: 'Add Ctr',
  bea_cukai: 'Bc',
  delivery_order: 'Do',
  invoice_fp_dp: 'DP',
  invoice_fp_payoff: 'Payoff',
  invoice_fp_full: 'Full',
};

const ALL_COMMERCIAL_DOCUMENT_TYPES: readonly string[] = [
  ...COMMERCIAL_DOCUMENT_TYPES,
  ...LEGACY_COMMERCIAL_DOCUMENT_TYPES,
];

export function isCommercialDocumentType(value: string): value is CommercialDocumentType {
  return (COMMERCIAL_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isAnyCommercialDocumentType(value: string): value is AnyCommercialDocumentType {
  return ALL_COMMERCIAL_DOCUMENT_TYPES.includes(value);
}

/** Map legacy stored types to the current checklist categories. */
export function canonicalCommercialDocumentType(
  value: string,
): CommercialDocumentType | null {
  const map: Record<string, CommercialDocumentType> = {
    draft_contract: 'draft_contract',
    contract: 'contract',
    addendum_contract: 'addendum_contract',
    bea_cukai: 'bea_cukai',
    delivery_order: 'delivery_order',
    invoice_fp_dp: 'invoice_fp_dp',
    invoice_fp_payoff: 'invoice_fp_payoff',
    invoice_fp_full: 'invoice_fp_full',
    dp: 'invoice_fp_dp',
    invoice_dp: 'invoice_fp_dp',
    ep_pelunasan: 'invoice_fp_payoff',
    invoice_pelunasan: 'invoice_fp_full',
  };
  return map[value] ?? null;
}

/** DB document_type values that belong to a checklist category (includes legacy). */
export function documentTypesForCategory(type: CommercialDocumentType): string[] {
  switch (type) {
    case 'invoice_fp_dp':
      return ['invoice_fp_dp', 'dp', 'invoice_dp'];
    case 'invoice_fp_payoff':
      return ['invoice_fp_payoff', 'ep_pelunasan'];
    case 'invoice_fp_full':
      return ['invoice_fp_full', 'invoice_pelunasan'];
    default:
      return [type];
  }
}

export function commercialDocumentTypeLabel(value: string): string {
  if (isCommercialDocumentType(value)) {
    return COMMERCIAL_DOCUMENT_TYPE_LABELS[value];
  }
  if ((LEGACY_COMMERCIAL_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return LEGACY_COMMERCIAL_DOCUMENT_TYPE_LABELS[value as LegacyCommercialDocumentType];
  }
  return value;
}

/** First 3 uppercase letters from buyer name (e.g. EOP from "EOP Trading"). */
export function buyerFilenamePrefix(buyerName: string): string {
  const letters = String(buyerName || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  if (letters.length >= 3) return letters.slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
}

/** @deprecated Use buyerFilenamePrefix */
export function supplierFilenamePrefix(supplierName: string): string {
  return buyerFilenamePrefix(supplierName);
}

export function sanitizePoForFilename(poNumber: string): string {
  return (
    String(poNumber || 'UNKNOWN')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\w.\-]/g, '')
      .slice(0, 80) || 'UNKNOWN'
  );
}

function safeFileExtension(originalName?: string): string {
  const ext = originalName?.includes('.')
    ? originalName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
    : 'pdf';
  return ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'pdf';
}

/**
 * Build stored filename: [BUY]_[DocCode]_[PO].ext
 * Re-uploads append (2), (3), … based on how many files already exist for the category.
 */
export function buildCommercialDocumentStoredName(input: {
  buyerName: string;
  documentType: CommercialDocumentType;
  referenceNumber: string;
  originalName?: string;
  /** Number of existing files for this document category (drives version suffix). */
  existingFileCount?: number;
  /** @deprecated Prefer existingFileCount — still accepted for backward compatibility. */
  existingFileNames?: string[];
}): string {
  const prefix = buyerFilenamePrefix(input.buyerName);
  const code = COMMERCIAL_DOCUMENT_FILENAME_CODES[input.documentType];
  const ref = sanitizePoForFilename(input.referenceNumber);
  const ext = safeFileExtension(input.originalName);
  const baseStem = `${prefix}_${code}_${ref}`;
  const existingCount =
    input.existingFileCount ??
    (input.existingFileNames ?? []).map((n) => String(n || '').trim()).filter(Boolean).length;

  if (existingCount <= 0) return `${baseStem}.${ext}`;
  return `${baseStem}(${existingCount + 1}).${ext}`;
}

/** @deprecated Use buildCommercialDocumentStoredName with supplier + documentType. */
export function buildLegacyCommercialDocumentStoredName(poNumber: string, originalName?: string): string {
  const base = `EU-CTR-${sanitizePoForFilename(poNumber)}`;
  const ext = safeFileExtension(originalName);
  return `${base}.${ext}`;
}

/** Synology share folder under the production KLIP upload root (`dev/KLIP`). */
export const COMMERCIAL_DOCS_SHARE_FOLDER = 'COMMERCIAL DOCS';

/** Local/SIT Docker-volume folder — not the production NAS share. */
export const COMMERCIAL_DOCS_LOCAL_FOLDER = 'commercial-documents';

/**
 * Production-only layout: `COMMERCIAL DOCS/{YYYY}/{MM}/{PO}` on
 * `\\172.30.1.94\APPs\dev\KLIP`.
 * Enable with KLIP_COMMERCIAL_DOCS_SHARE=1 or KLIP_ENV=prod. SIT/local stay off.
 */
export function useCommercialDocsNasLayout(): boolean {
  const share = String(process.env.KLIP_COMMERCIAL_DOCS_SHARE || '').trim().toLowerCase();
  if (share === '1' || share === 'true' || share === 'yes') return true;
  const env = String(process.env.KLIP_ENV || '').trim().toLowerCase();
  return env === 'prod' || env === 'production';
}

/** Calendar year/month in Asia/Jakarta (bulan berjalan), not contract date. */
export function commercialDocumentUploadCalendar(now: Date = new Date()): { year: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? String(now.getUTCFullYear());
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return { year, month };
}

/**
 * Relative dir under uploads root.
 * Production NAS: `COMMERCIAL DOCS/{YYYY}/{MM}/{PO}` (tahun/bulan berjalan Asia/Jakarta).
 * SIT/local: `commercial-documents/{PO}` on the Docker volume.
 */
export function commercialDocumentUploadRelativeDir(poNumber: string, now: Date = new Date()): string {
  const po = sanitizePoForFilename(poNumber);
  if (!useCommercialDocsNasLayout()) {
    return `${COMMERCIAL_DOCS_LOCAL_FOLDER}/${po}`;
  }
  const { year, month } = commercialDocumentUploadCalendar(now);
  return `${COMMERCIAL_DOCS_SHARE_FOLDER}/${year}/${month}/${po}`;
}

/** @deprecated Use commercialDocumentUploadRelativeDir — kept for older path readers. */
export function commercialDocumentMonthFolder(contractDate: Date | string | null | undefined): string {
  const raw = contractDate instanceof Date ? contractDate : new Date(String(contractDate ?? ''));
  if (Number.isNaN(raw.getTime())) {
    const { year, month } = commercialDocumentUploadCalendar();
    return `${year}-${month}`;
  }
  return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}`;
}
