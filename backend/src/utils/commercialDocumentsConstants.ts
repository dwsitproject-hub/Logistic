export const COMMERCIAL_DOCUMENT_TYPES = [
  'contract',
  'faktur_pajak',
  'dp',
  'invoice_dp',
  'ep_pelunasan',
  'invoice_pelunasan',
] as const;

export type CommercialDocumentType = (typeof COMMERCIAL_DOCUMENT_TYPES)[number];

export const COMMERCIAL_DOCUMENT_TYPE_LABELS: Record<CommercialDocumentType, string> = {
  contract: 'Contract',
  faktur_pajak: 'Faktur Pajak',
  dp: 'DP',
  invoice_dp: 'Invoice DP',
  ep_pelunasan: 'EP Pelunasan',
  invoice_pelunasan: 'Invoice Pelunasan',
};

export function isCommercialDocumentType(value: string): value is CommercialDocumentType {
  return (COMMERCIAL_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function sanitizePoForFilename(poNumber: string): string {
  return String(poNumber || 'UNKNOWN')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-]/g, '')
    .slice(0, 80) || 'UNKNOWN';
}

export function buildCommercialDocumentStoredName(poNumber: string): string {
  return `EU-CTR-${sanitizePoForFilename(poNumber)}.pdf`;
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
