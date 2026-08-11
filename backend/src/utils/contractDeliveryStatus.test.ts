import { describe, expect, it } from 'vitest';
import {
  aggregateImportStatusForStoGroup,
  isContractDeliveryClosed,
  isStoGroupSapClosed,
  normalizeContractDeliveryStatusForDisplay,
  sqlContractImportStatusExpr,
  sqlContractImportStatusIsClosedExpr,
  sqlContractImportStatusIsOpenExpr,
  sqlIsContractSapClosedExpr,
  sqlIsContractSapClosedForStoExpr,
  sqlIsContractSapClosedForShipmentBacklogExpr,
  sqlNormalizeContractDeliveryStatusExpr,
  sqlShipmentBacklogSpdSeaLegFilterSql,
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

describe('aggregateImportStatusForStoGroup / isStoGroupSapClosed', () => {
  it('returns Open when any member is Open', () => {
    expect(aggregateImportStatusForStoGroup(['Close', 'Open'])).toBe('Open');
    expect(aggregateImportStatusForStoGroup(['Close', 'ACTIVE'])).toBe('Open');
    expect(isStoGroupSapClosed(['Close', 'Open'])).toBe(false);
  });

  it('returns Close only when every member is Close', () => {
    expect(aggregateImportStatusForStoGroup(['Close', 'COMPLETED'])).toBe('Close');
    expect(isStoGroupSapClosed(['Close', 'COMPLETED'])).toBe(true);
  });

  it('returns null for empty or blank member list', () => {
    expect(aggregateImportStatusForStoGroup([])).toBeNull();
    expect(aggregateImportStatusForStoGroup(['', null])).toBeNull();
    expect(isStoGroupSapClosed([])).toBe(false);
  });

  it('returns Cancelled when no Open and not all Close', () => {
    expect(aggregateImportStatusForStoGroup(['Cancelled', 'Close'])).toBe('Cancelled');
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
    expect(sql).toContain('row_open');
    expect(sql).not.toContain('LIMIT 1');
    // Per-row SAP pick uses NULL fallback (blank GR ignored); outer COALESCE may use c.status.
    expect(sql).toContain(', NULL)');
    expect(sql).toContain('BOOL_OR(s.row_open)');
    // Open signal is GR PO/STO only — not commercial Status (blocks false Open → Planned)
    expect(sql).not.toMatch(/row_open[\s\S]*->>'Status'/);
    expect(sql).toContain("'CFR'");
    // PO-wide (no stoKey) must not force SPD STO equality
    expect(sql).not.toContain("= TRIM((sp.sto_key)::text)");
  });

  it('scopes LCO/FOB GR Close to sto_key while CIF/CFR stay PO-wide', () => {
    const scoped = sqlContractImportStatusExpr('c', 'c.po_number', 'sp.sto_key');
    expect(scoped).toContain('sp.sto_key');
    expect(scoped).toContain('sto_number');
    expect(scoped).toContain("'FOB'");
    expect(scoped).toContain("'CIF'");
    // Synthetic OP-/MNL keys skip STO equality filter
    expect(scoped).toContain("'^OP-'");
    expect(scoped).toContain("'^(MNL-|MSEA-)'");
  });

  it('builds SAP closed predicate from PO-aware import status', () => {
    const sql = sqlIsContractSapClosedExpr('c');
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('BOOL_OR');
    expect(sql).toContain('GR PO Status');
    expect(sql).not.toContain("->'raw'->>'Status'");
  });

  it('builds STO-scoped closed predicate for SEA list / Perf parity', () => {
    const sql = sqlIsContractSapClosedForStoExpr('c', 'sp.sto_key');
    expect(sql).toContain('sp.sto_key');
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain('BOOL_OR');
  });
});

describe('sqlContractImportStatusIsOpenExpr / ClosedExpr', () => {
  it('matches Open/Close on import_status column', () => {
    expect(sqlContractImportStatusIsOpenExpr('base.import_status')).toContain('OPEN');
    expect(sqlContractImportStatusIsClosedExpr('base.import_status')).toContain('CLOSED');
  });
});

describe('sqlShipmentBacklogSpdSeaLegFilterSql / sqlIsContractSapClosedForShipmentBacklogExpr', () => {
  it('filters FOB backlog closed check to sea-leg STO rows only', () => {
    const filter = sqlShipmentBacklogSpdSeaLegFilterSql('c');
    expect(filter).toContain("<> 'FOB'");
    expect(filter).toContain("= 'V'");
    expect(filter).toContain('IS DISTINCT FROM');
  });

  it('builds FOB-scoped closed predicate for shipment contract backlog', () => {
    const sql = sqlIsContractSapClosedForShipmentBacklogExpr('c');
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain("<> 'FOB'");
    expect(sql).toContain("= 'V'");
    expect(sql).toContain('BOOL_OR');
  });
});
