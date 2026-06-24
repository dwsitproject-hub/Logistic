import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentStoredName,
  canonicalCommercialDocumentType,
  documentTypesForCategory,
  supplierFilenamePrefix,
} from './commercialDocumentsConstants';

describe('commercialDocumentsConstants', () => {
  it('supplierFilenamePrefix uses first 3 uppercase letters', () => {
    expect(supplierFilenamePrefix('EOP Trading')).toBe('EOP');
    expect(supplierFilenamePrefix('ab')).toBe('ABX');
  });

  it('buildCommercialDocumentStoredName follows AAA_Ctr_PO pattern', () => {
    const name = buildCommercialDocumentStoredName({
      supplierName: 'EOP Supplier',
      documentType: 'contract',
      poNumber: '1381002365',
      originalName: 'scan.pdf',
      existingFileNames: [],
    });
    expect(name).toBe('EOP_Ctr_1381002365.pdf');
  });

  it('buildCommercialDocumentStoredName supports Add Ctr code with space', () => {
    const name = buildCommercialDocumentStoredName({
      supplierName: 'EOP',
      documentType: 'addendum_contract',
      poNumber: '1381002365',
      originalName: 'addendum.pdf',
    });
    expect(name).toBe('EOP_Add Ctr_1381002365.pdf');
  });

  it('buildCommercialDocumentStoredName appends version suffix on re-upload', () => {
    const second = buildCommercialDocumentStoredName({
      supplierName: 'EOP',
      documentType: 'contract',
      poNumber: '1381002365',
      originalName: 'scan.pdf',
      existingFileNames: ['EOP_Ctr_1381002365.pdf'],
    });
    expect(second).toBe('EOP_Ctr_1381002365(2).pdf');

    const third = buildCommercialDocumentStoredName({
      supplierName: 'EOP',
      documentType: 'contract',
      poNumber: '1381002365',
      existingFileNames: ['EOP_Ctr_1381002365.pdf', 'EOP_Ctr_1381002365(2).pdf'],
    });
    expect(third).toBe('EOP_Ctr_1381002365(3).pdf');
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
