import { describe, expect, it } from 'vitest';
import {
  deriveTruckingEffectiveStatus,
  hasTruckingKlipPlanning,
  hasTruckingSto,
  isTruckingCompletedByGrAndOs,
} from './truckingEffectiveStatus';
import {
  isTruckingPipelineCompleted,
  TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
  sqlTruckingPipelineIsCompletedExpr,
} from './truckingQuantitySql';

describe('truckingEffectiveStatus', () => {
  it('deriveTruckingEffectiveStatus uses realization start for IN_PROGRESS only', () => {
    expect(deriveTruckingEffectiveStatus('CANCELLED', null, null)).toBe('CANCELLED');
    expect(deriveTruckingEffectiveStatus('PLANNED', null, null, { stoNumber: 'STO-1' })).toBe(
      'UNPLANNED',
    );
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        dailyDeliverables: [{ date: '2026-06-01', quantity_delivered: 1000 }],
      }),
    ).toBe('PLANNED');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null, {
        stoNumber: 'STO-1',
        dailyDeliverables: [{ date: '2026-06-01', quantity_delivered: 1000 }],
      }),
    ).toBe('IN_PROGRESS');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', '2026-06-30', { stoNumber: 'STO-1' }),
    ).toBe('IN_PROGRESS');
  });

  it('does not complete from last receive date alone when GR Open and OS above tolerance', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, '2026-06-30', {
        stoNumber: 'STO-1',
        contractImportStatus: 'Open',
        outstandingQtyKg: 5000,
      }),
    ).toBe('UNPLANNED');
  });

  it('returns COMPLETED when GR is Close regardless of OS Qty', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Close',
        outstandingQtyKg: 5000,
      }),
    ).toBe('COMPLETED');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Close',
        outstandingQtyKg: TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG + 100,
      }),
    ).toBe('COMPLETED');
  });

  it('returns COMPLETED when GR is Open and OS within tolerance', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Open',
        outstandingQtyKg: 0,
      }),
    ).toBe('COMPLETED');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Open',
        outstandingQtyKg: TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
      }),
    ).toBe('COMPLETED');
  });

  it('does not complete when GR is Open and OS exceeds tolerance', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Open',
        outstandingQtyKg: TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG + 1,
      }),
    ).toBe('UNPLANNED');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Open',
        outstandingQtyKg: 5000,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('isTruckingPipelineCompleted accepts GR Close or OS tolerance', () => {
    expect(isTruckingPipelineCompleted('Close', 100)).toBe(true);
    expect(isTruckingPipelineCompleted('Close', null)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 0)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 100)).toBe(false);
    expect(isTruckingCompletedByGrAndOs('Close', 100)).toBe(true);
  });

  it('sqlTruckingPipelineIsCompletedExpr uses OR between GR Close and OS tolerance', () => {
    const sql = sqlTruckingPipelineIsCompletedExpr('c');
    expect(sql).toContain(' OR ');
    expect(sql).not.toMatch(/\)\s*AND\s*\(/);
  });

  it('hasTruckingKlipPlanning requires dated rows with qty', () => {
    expect(hasTruckingKlipPlanning([])).toBe(false);
    expect(hasTruckingKlipPlanning([{ date: '2026-01-01', quantity_delivered: 0 }])).toBe(false);
    expect(hasTruckingKlipPlanning([{ date: '2026-01-01', quantity_delivered: 500 }])).toBe(true);
  });

  it('hasTruckingSto checks non-empty STO', () => {
    expect(hasTruckingSto(null)).toBe(false);
    expect(hasTruckingSto('  ')).toBe(false);
    expect(hasTruckingSto('STO-123')).toBe(true);
  });
});
