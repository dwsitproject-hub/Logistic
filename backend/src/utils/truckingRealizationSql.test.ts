import { describe, expect, it } from 'vitest';
import {
  sqlRealizationStartDate,
  sqlShellRealizationStartDate,
} from './truckingRealizationSql';

describe('truckingRealizationSql', () => {
  it('sqlRealizationStartDate prefers SAP then WB realization then op start', () => {
    const sql = sqlRealizationStartDate('c');
    expect(sql).toContain('Trucking Start Receive Date');
    expect(sql).toContain('tr.realization_start_date');
    expect(sql).toContain('t.trucking_start_date');
    const sapIdx = sql.indexOf('Trucking Start Receive Date');
    const trIdx = sql.indexOf('tr.realization_start_date');
    const opIdx = sql.indexOf('t.trucking_start_date');
    expect(sapIdx).toBeLessThan(trIdx);
    expect(trIdx).toBeLessThan(opIdx);
  });

  it('sqlShellRealizationStartDate stays DB-only for fast shell', () => {
    const sql = sqlShellRealizationStartDate();
    expect(sql).toContain('tr.realization_start_date');
    expect(sql).toContain('t.trucking_start_date');
    expect(sql).not.toContain('sap_processed_data');
  });
});
