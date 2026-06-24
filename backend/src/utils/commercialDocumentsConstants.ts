export const COMMERCIAL_DOCUMENT_TYPES = [
  'contract',
  'addendum_contract',
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
  contract: 'Contract',
  addendum_contract: 'Addendum Contract',
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
  contract: 'Ctr',
  addendum_contract: 'Add Ctr',
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

/** Map legacy stored types to the 5 current checklist categories. */
export function canonicalCommercialDocumentType(
  value: string,
): CommercialDocumentType | null {
  const map: Record<string, CommercialDocumentType> = {
    contract: 'contract',
    addendum_contract: 'addendum_contract',
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

/** First 3 uppercase letters from supplier name (e.g. EOP from "EOP Supplier"). */
export function supplierFilenamePrefix(supplierName: string): string {
  const letters = String(supplierName || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  if (letters.length >= 3) return letters.slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build stored filename: [SUP]_[DocCode]_[PO].ext
 * Re-uploads append (2), (3), … before the extension when the base name already exists.
 */
export function buildCommercialDocumentStoredName(input: {
  supplierName: string;
  documentType: CommercialDocumentType;
  poNumber: string;
  originalName?: string;
  existingFileNames?: string[];
}): string {
  const prefix = supplierFilenamePrefix(input.supplierName);
  const code = COMMERCIAL_DOCUMENT_FILENAME_CODES[input.documentType];
  const po = sanitizePoForFilename(input.poNumber);
  const ext = safeFileExtension(input.originalName);
  const baseStem = `${prefix}_${code}_${po}`;
  const existing = (input.existingFileNames ?? []).map((n) => String(n || '').trim()).filter(Boolean);

  let maxVersion = 0;
  const exactBase = `${baseStem}.${ext}`;
  const versionRe = new RegExp(`^${escapeRegExp(baseStem)}\\((\\d+)\\)\\.${escapeRegExp(ext)}$`, 'i');

  for (const name of existing) {
    if (name.toLowerCase() === exactBase.toLowerCase()) {
      maxVersion = Math.max(maxVersion, 1);
      continue;
    }
    const match = name.match(versionRe);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) maxVersion = Math.max(maxVersion, n);
    }
  }

  if (maxVersion === 0) return exactBase;
  return `${baseStem}(${maxVersion + 1}).${ext}`;
}

/** @deprecated Use buildCommercialDocumentStoredName with supplier + documentType. */
export function buildLegacyCommercialDocumentStoredName(poNumber: string, originalName?: string): string {
  const base = `EU-CTR-${sanitizePoForFilename(poNumber)}`;
  const ext = safeFileExtension(originalName);
  return `${base}.${ext}`;
}

/** Folder under uploads root: commercial-documents/YYYY-MM */
export function commercialDocumentMonthFolder(contractDate: Date | string | null | undefined): string {
  const raw = contractDate instanceof Date ? contractDate : new Date(String(contractDate ?? ''));
  if (Number.isNaN(raw.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}`;
}
