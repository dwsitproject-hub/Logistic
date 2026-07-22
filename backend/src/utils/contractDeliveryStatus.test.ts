import { describe, expect, it } from 'vitest';
import {
  isContractDeliveryClosed,
  normalizeContractDeliveryStatusForDisplay,
  sqlContractImportStatusExpr,
  sqlContractImportStatusIsClosedExpr,
  sqlContractImportStatusIsOpenExpr,
  sqlIsContractSapClosedExpr,
  sqlNormalizeContractDeliveryStatusExpr,
} from './contractDeliveryStatus';

describe('normalizeContractDeliveryStatusForDisplay', () => {
  it('maps legacy ACTIVE/COMPLETED to Open/Close', () => {
    expect(normalizeContractDeliveryStatusForDisplay('ACTIVE')).toBe('Open');
    expect(normalizeContractDeliveryStatusForDisplay('COMPLETED')).toBe('Close');
    expect(normalizeContractDeliveryStatusForDisplay('Open')).toBe('Open');
  });
});

describe('sqlNormalizeContractDeliveryStatusExpr', () => {
  it('normalizes ACTIVE to Open in SQL', () => {
    expect(sqlNormalizeContractDeliveryStatusExpr('c.status')).toContain("'ACTIVE'");
    expect(sqlNormalizeContractDeliveryStatusExpr('c.status')).toContain("'Open'");
  });
});

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
  it('aggregates PO-scoped SAP status with any-Open wins (no LIMIT 1 fallback to COMPLETED)', () => {
    const sql = sqlContractImportStatusExpr('c', 'c.po_number');
    expect(sql).toContain('spd.po_number');
    expect(sql).toContain('GR PO Status');
    expect(sql).toContain('GR STO Status');
    expect(sql).toContain('BOOL_OR');
    expect(sql).toContain("'OPEN'");
    expect(sql).toContain("'ACTIVE'");
    expect(sql).not.toContain('LIMIT 1');
    // Per-row SAP pick uses NULL fallback (blank GR ignored); outer COALESCE may use c.status.
    expect(sql).toContain(', NULL)');
    expect(sql).toContain('BOOL_OR(UPPER(TRIM(COALESCE(s.st');
  });

  it('builds SAP closed predicate from PO-aware import status', () => {
    const sql = sqlIsContractSapClosedExpr('c');
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('BOOL_OR');
  });
});

describe('sqlContractImportStatusIsOpenExpr / ClosedExpr', () => {
  it('matches Open/Close on import_status column', () => {
    expect(sqlContractImportStatusIsOpenExpr('base.import_status')).toContain('OPEN');
    expect(sqlContractImportStatusIsClosedExpr('base.import_status')).toContain('CLOSED');
  });
});
