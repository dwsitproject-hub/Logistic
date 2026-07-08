import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentStoredName,
  buyerFilenamePrefix,
  canonicalCommercialDocumentType,
  documentTypesForCategory,
  supplierFilenamePrefix,
} from './commercialDocumentsConstants';

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
});
