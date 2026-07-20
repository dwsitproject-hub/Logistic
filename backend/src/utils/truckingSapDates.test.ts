import { describe, expect, it } from 'vitest';
import {
  sqlMaxTruckingRealizationEndForContract,
  sqlMinTruckingRealizationStartForContract,
  sqlSapTruckingLastReceiveDateForLookupKeys,
  sqlSapTruckingLastReceiveDateForStoKey,
} from './truckingSapDates';

describe('truckingSapDates', () => {
  it('sqlMaxTruckingRealizationEndForContract uses extension then SAP AW then WB (not planning columns)', () => {
    const sql = sqlMaxTruckingRealizationEndForContract('c.id', 'c.contract_id');
    expect(sql).toContain('trucking_realizations');
    expect(sql).toContain('realization_end_date');
    expect(sql).toContain('Trucking Last Receive Date');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('progress_date');
    expect(sql).not.toContain('t.trucking_completion_date');
    expect(sql).toContain('MM/DD/YYYY');
    const sapIdx = sql.indexOf('Trucking Last Receive Date');
    const wbIdx = sql.indexOf('trucking_daily_actuals');
    expect(sapIdx).toBeGreaterThan(-1);
    expect(wbIdx).toBeGreaterThan(-1);
    expect(sapIdx).toBeLessThan(wbIdx);
  });

  it('sqlMinTruckingRealizationStartForContract prefers SAP AV then WB/extension then op start', () => {
    const sql = sqlMinTruckingRealizationStartForContract('c.id', 'c.contract_id');
    expect(sql).toContain('realization_start_date');
    expect(sql).toContain('Trucking Start Receive Date');
    expect(sql).toContain('t.trucking_start_date');
    // SAP subquery appears before tr.realization in COALESCE order
    const sapIdx = sql.indexOf('Trucking Start Receive Date');
    const trIdx = sql.indexOf('tr.realization_start_date');
    expect(sapIdx).toBeGreaterThan(-1);
    expect(trIdx).toBeGreaterThan(-1);
    expect(sapIdx).toBeLessThan(trIdx);
  });

  it('sqlSapTruckingLastReceiveDateForStoKey scopes by effective STO', () => {
    const sql = sqlSapTruckingLastReceiveDateForStoKey('c.contract_id', 'sk.sto_key');
    expect(sql).toContain('sk.sto_key');
    expect(sql).toContain('ORDER BY spd.created_at DESC');
    expect(sql).toContain('Trucking Last Receive Date');
  });

  it('sqlSapTruckingLastReceiveDateForLookupKeys matches operation id or sto keys', () => {
    const sql = sqlSapTruckingLastReceiveDateForLookupKeys('c.contract_id', '$2::text[]');
    expect(sql).toContain('Operation ID');
    expect(sql).toContain('$2::text[]');
  });
});
