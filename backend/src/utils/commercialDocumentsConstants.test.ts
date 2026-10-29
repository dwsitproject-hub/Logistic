import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentStoredName,
  buyerFilenamePrefix,
  canonicalCommercialDocumentType,
  COMMERCIAL_DOCUMENT_TYPES,
  commercialDocumentUploadPermissionKey,
  commercialDocumentTypeLabel,
  commercialDocumentUploadRelativeDir,
  documentTypesForCategory,
  isCommercialDocumentType,
  supplierFilenamePrefix,
  useCommercialDocsNasLayout,
} from './commercialDocumentsConstants';

function withNasLayoutEnv(enabled: boolean, run: () => void): void {
  const prevShare = process.env.KLIP_COMMERCIAL_DOCS_SHARE;
  const prevEnv = process.env.KLIP_ENV;
  try {
    if (enabled) {
      process.env.KLIP_COMMERCIAL_DOCS_SHARE = '1';
      delete process.env.KLIP_ENV;
    } else {
      delete process.env.KLIP_COMMERCIAL_DOCS_SHARE;
      delete process.env.KLIP_ENV;
    }
    run();
  } finally {
    if (prevShare === undefined) delete process.env.KLIP_COMMERCIAL_DOCS_SHARE;
    else process.env.KLIP_COMMERCIAL_DOCS_SHARE = prevShare;
    if (prevEnv === undefined) delete process.env.KLIP_ENV;
    else process.env.KLIP_ENV = prevEnv;
  }
}

describe('commercialDocumentsConstants', () => {
  it('buyerFilenamePrefix uses first 3 uppercase letters', () => {
    expect(buyerFilenamePrefix('EOP Trading')).toBe('EOP');
    expect(buyerFilenamePrefix('EUP Buyer')).toBe('EUP');
    expect(buyerFilenamePrefix('ab')).toBe('ABX');
  });

  it('supplierFilenamePrefix delegates to buyerFilenamePrefix', () => {
    expect(supplierFilenamePrefix('EOP Trading')).toBe('EOP');
  });

  it('buildCommercialDocumentStoredName follows BUY_Ctr_PO pattern', () => {
    const name = buildCommercialDocumentStoredName({
      buyerName: 'EOP Trading',
      documentType: 'contract',
      referenceNumber: '1381002868',
      originalName: 'scan.pdf',
      existingFileNames: [],
    });
    expect(name).toBe('EOP_Ctr_1381002868.pdf');
  });

  it('buildCommercialDocumentStoredName supports Add Ctr code with space', () => {
    const name = buildCommercialDocumentStoredName({
      buyerName: 'EOP',
      documentType: 'addendum_contract',
      referenceNumber: '1381002868',
      originalName: 'addendum.pdf',
    });
    expect(name).toBe('EOP_Add Ctr_1381002868.pdf');
  });

  it('buildCommercialDocumentStoredName appends version suffix on re-upload', () => {
    const second = buildCommercialDocumentStoredName({
      buyerName: 'EOP',
      documentType: 'contract',
      referenceNumber: '1381002868',
      originalName: 'scan.pdf',
      existingFileCount: 1,
    });
    expect(second).toBe('EOP_Ctr_1381002868(2).pdf');

    const third = buildCommercialDocumentStoredName({
      buyerName: 'EOP',
      documentType: 'contract',
      referenceNumber: '1381002868',
      existingFileCount: 2,
    });
    expect(third).toBe('EOP_Ctr_1381002868(3).pdf');
  });

  it('buildCommercialDocumentStoredName versions by file count even after legacy PO-based names', () => {
    const second = buildCommercialDocumentStoredName({
      buyerName: 'EOP',
      documentType: 'contract',
      referenceNumber: '1381002868',
      existingFileNames: ['EOP_Ctr_005CPOTSP-EOPVII2026.pdf'],
    });
    expect(second).toBe('EOP_Ctr_1381002868(2).pdf');
  });

  it('canonicalCommercialDocumentType maps legacy types', () => {
    expect(canonicalCommercialDocumentType('dp')).toBe('invoice_fp_dp');
    expect(canonicalCommercialDocumentType('invoice_pelunasan')).toBe('invoice_fp_full');
    expect(canonicalCommercialDocumentType('faktur_pajak')).toBeNull();
  });

  it('documentTypesForCategory includes legacy DB values', () => {
    expect(documentTypesForCategory('invoice_fp_dp')).toContain('dp');
    expect(documentTypesForCategory('invoice_fp_payoff')).toContain('ep_pelunasan');
  });

  it('buildCommercialDocumentStoredName uses Dctr Bc Do codes', () => {
    expect(
      buildCommercialDocumentStoredName({
        buyerName: 'EOP Trading',
        documentType: 'draft_contract',
        referenceNumber: '1381002868',
        originalName: 'draft.pdf',
      }),
    ).toBe('EOP_Dctr_1381002868.pdf');
    expect(
      buildCommercialDocumentStoredName({
        buyerName: 'EOP Trading',
        documentType: 'bea_cukai',
        referenceNumber: '1381002868',
        originalName: 'bc.pdf',
      }),
    ).toBe('EOP_Bc_1381002868.pdf');
    expect(
      buildCommercialDocumentStoredName({
        buyerName: 'EOP Trading',
        documentType: 'delivery_order',
        referenceNumber: '1381002868',
        originalName: 'do.pdf',
      }),
    ).toBe('EOP_Do_1381002868.pdf');
  });

  it('Berita Acara is a checklist category with its own filename code, listed right after Addendum Contract', () => {
    expect(COMMERCIAL_DOCUMENT_TYPES.indexOf('berita_acara')).toBe(
      COMMERCIAL_DOCUMENT_TYPES.indexOf('addendum_contract') + 1,
    );
    expect(isCommercialDocumentType('berita_acara')).toBe(true);
    expect(commercialDocumentTypeLabel('berita_acara')).toBe('Berita Acara (BA)');
    expect(canonicalCommercialDocumentType('berita_acara')).toBe('berita_acara');
    expect(documentTypesForCategory('berita_acara')).toEqual(['berita_acara']);
    expect(
      buildCommercialDocumentStoredName({
        buyerName: 'EOP Trading',
        documentType: 'berita_acara',
        referenceNumber: '1381002868',
        originalName: 'ba.pdf',
      }),
    ).toBe('EOP_Ba_1381002868.pdf');
  });

  it('upload permission is one key per document type, under data.commercial_documents', () => {
    expect(commercialDocumentUploadPermissionKey('delivery_order')).toBe('data.commercial_documents.upload.delivery_order');
    expect(commercialDocumentUploadPermissionKey('berita_acara')).toBe('data.commercial_documents.upload.berita_acara');
    const keys = COMMERCIAL_DOCUMENT_TYPES.map(commercialDocumentUploadPermissionKey);
    expect(new Set(keys).size).toBe(COMMERCIAL_DOCUMENT_TYPES.length);
    for (const key of keys) expect(key.startsWith('data.commercial_documents.upload.')).toBe(true);
  });

  it('SIT/local writes under commercial-documents without NAS year-month folders', () => {
    withNasLayoutEnv(false, () => {
      expect(useCommercialDocsNasLayout()).toBe(false);
      expect(
        commercialDocumentUploadRelativeDir(
          '1381002868',
          new Date('2026-09-18T03:00:00.000Z'),
        ),
      ).toBe('commercial-documents/1381002868');
    });
  });

  it('production NAS layout uses current Jakarta year/month under commercial-docs', () => {
    withNasLayoutEnv(true, () => {
      expect(useCommercialDocsNasLayout()).toBe(true);
      const dir = commercialDocumentUploadRelativeDir(
        '1381002868',
        new Date('2026-09-18T03:00:00.000Z'),
      );
      expect(dir).toBe('commercial-docs/2026/09/1381002868');
    });
  });

  it('production NAS layout rolls to the next Jakarta year', () => {
    withNasLayoutEnv(true, () => {
      const dir = commercialDocumentUploadRelativeDir(
        '1381002868',
        new Date('2026-12-31T17:30:00.000Z'),
      );
      expect(dir).toBe('commercial-docs/2027/01/1381002868');
    });
  });
});
