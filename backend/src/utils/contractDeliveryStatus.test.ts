import { describe, expect, it } from 'vitest';
import {
  isContractDeliveryClosed,
  sqlContractImportStatusExpr,
  sqlContractImportStatusIsClosedExpr,
  sqlContractImportStatusIsOpenExpr,
  sqlIsContractSapClosedExpr,
} from './contractDeliveryStatus';

describe('isContractDeliveryClosed', () => {
  it('returns true for Close variants', () => {
    expect(isContractDeliveryClosed('Close')).toBe(true);
    expect(isContractDeliveryClosed('CLOSE')).toBe(true);
    expect(isContractDeliveryClosed('CLOSED')).toBe(true);
    expect(isContractDeliveryClosed('COMPLETED')).toBe(true);
    expect(isContractDeliveryClosed('COMPLETE')).toBe(true);
  });

  it('returns false for open or empty statuses', () => {
    expect(isContractDeliveryClosed('Open')).toBe(false);
    expect(isContractDeliveryClosed('ACTIVE')).toBe(false);
    expect(isContractDeliveryClosed('')).toBe(false);
    expect(isContractDeliveryClosed(null)).toBe(false);
  });
});

describe('sqlContractImportStatusExpr', () => {
  it('prefers PO-scoped SAP status over contract-level rows', () => {
    const sql = sqlContractImportStatusExpr('c', 'c.po_number');
    expect(sql).toContain('spd.po_number');
    expect(sql).toContain('GR PO Status');
    expect(sql).toContain('GR STO Status');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('THEN 0');
  });

  it('builds SAP closed predicate from PO-aware import status', () => {
    const sql = sqlIsContractSapClosedExpr('c');
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain('c.po_number');
  });
});

describe('sqlContractImportStatusIsOpenExpr / ClosedExpr', () => {
  it('matches Open/Close on import_status column', () => {
    expect(sqlContractImportStatusIsOpenExpr('base.import_status')).toContain('OPEN');
    expect(sqlContractImportStatusIsClosedExpr('base.import_status')).toContain('CLOSED');
  });
});
