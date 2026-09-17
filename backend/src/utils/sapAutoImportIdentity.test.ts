import { describe, expect, it } from 'vitest';
import { SapMasterV2ImportService, type FieldMetadata } from '../services/sapMasterV2Import.service';
import {
  identityFromParsedSapRow,
  identityToFailedCells,
  identityToSuccessCells,
  SAP_AUTO_IMPORT_FAILED_HEADERS,
  SAP_AUTO_IMPORT_SUCCESS_HEADERS,
} from './sapAutoImportIdentity';

function headersToMetadata(headers: string[]): FieldMetadata[] {
  return headers.map((headerName, index) => ({
    columnIndex: index,
    index,
    headerName,
    sapSource1: '',
    sapSource2: '',
    userRole: '',
    isFromSap: true,
    isManualEntry: false,
    isCalculated: false,
  }));
}

describe('identityFromParsedSapRow', () => {
  it('reads contract date, contract, ext no, PO, STO, supplier from a parsed MASTER v2 row', () => {
    const parsed = SapMasterV2ImportService.parseDataRowForTest(
      ['2026-08-01', 'CTR-1', 'EXT-9', '1581000001', '1006010001', 'PT Supplier'],
      headersToMetadata([
        'Contract Date',
        'Contract No',
        'Contract Ext No',
        'PO No',
        'STO No',
        'Supplier',
      ]),
    ) as {
      contract: Record<string, unknown>;
      shipment: Record<string, unknown>;
      raw: Record<string, unknown>;
    };

    const identity = identityFromParsedSapRow(parsed);
    expect(identity.contractDate).toBe('2026-08-01');
    expect(identity.contractNumber).toBe('CTR-1');
    expect(identity.contractExtNo).toBe('EXT-9');
    expect(identity.poNumber).toBe('1581000001');
    expect(identity.stoNumber).toBe('1006010001');
    expect(identity.supplier).toBe('PT Supplier');
  });

  it('falls back to raw headers when contract fields are empty', () => {
    const identity = identityFromParsedSapRow({
      contract: {},
      shipment: {},
      raw: {
        'Contract Date': '01.08.2026',
        'Contract No.': 'C-2',
        'Contract Ext No': 'E-2',
        'PO No.': 'PO-2',
        'STO No.': 'STO-2',
        Supplier: 'Vendor A',
      },
    });
    expect(identity).toEqual({
      contractDate: '01.08.2026',
      contractNumber: 'C-2',
      contractExtNo: 'E-2',
      poNumber: 'PO-2',
      stoNumber: 'STO-2',
      supplier: 'Vendor A',
    });
  });

  it('maps success/failed workbook cells including Remarks', () => {
    expect(SAP_AUTO_IMPORT_SUCCESS_HEADERS).toEqual([
      'Contract Date',
      'Contract',
      'Contract Ext No',
      'PO',
      'STO',
      'Supplier',
    ]);
    expect(SAP_AUTO_IMPORT_FAILED_HEADERS[6]).toBe('Remarks');
    const row = {
      contractDate: 'd',
      contractNumber: 'c',
      contractExtNo: 'e',
      poNumber: 'p',
      stoNumber: 's',
      supplier: 'v',
      remarks: 'Row 3: boom',
    };
    expect(identityToSuccessCells(row)).toEqual(['d', 'c', 'e', 'p', 's', 'v']);
    expect(identityToFailedCells(row)).toEqual(['d', 'c', 'e', 'p', 's', 'v', 'Row 3: boom']);
  });
});
