import { describe, expect, it } from 'vitest';
import {
  deriveTruckingEffectiveStatus,
  hasTruckingKlipPlanning,
  hasTruckingSto,
} from './truckingEffectiveStatus';

describe('truckingEffectiveStatus', () => {
  it('deriveTruckingEffectiveStatus uses realization dates for IN_PROGRESS/COMPLETED', () => {
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
    ).toBe('COMPLETED');
    expect(
      deriveTruckingEffectiveStatus('IN_TRANSIT', '2025-01-01', '2025-01-10', { stoNumber: 'STO-1' }),
    ).toBe('COMPLETED');
  });

  it('planning dates alone do not advance status without realization', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        dailyDeliverables: [{ date: '2026-06-01', quantity_delivered: 1000 }],
      }),
    ).toBe('PLANNED');
  });

  it('returns COMPLETED when SAP contract status is Close without realization dates', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Close',
      }),
    ).toBe('COMPLETED');
  });

  it('returns COMPLETED when SAP contract is Close even with only realization start', () => {
    expect(
      deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null, {
        stoNumber: 'STO-1',
        contractImportStatus: 'Close',
      }),
    ).toBe('COMPLETED');
  });

  it('returns UNPLANNED for open SAP contract without STO when no planning/realization', () => {
    expect(deriveTruckingEffectiveStatus('PLANNED', null, null)).toBe('UNPLANNED');
    expect(
      deriveTruckingEffectiveStatus('PLANNED', null, null, { contractImportStatus: 'Open' }),
    ).toBe('UNPLANNED');
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
