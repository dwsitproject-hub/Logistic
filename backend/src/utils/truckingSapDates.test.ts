import { describe, expect, it } from 'vitest';
import {
  sqlMaxTruckingRealizationEndForContract,
  sqlMinTruckingRealizationStartForContract,
  sqlSapTruckingLastReceiveDateForLookupKeys,
  sqlSapTruckingLastReceiveDateForStoKey,
} from './truckingSapDates';

describe('truckingSapDates', () => {
  it('sqlMaxTruckingRealizationEndForContract uses extension then SAP AW (not planning columns)', () => {
    const sql = sqlMaxTruckingRealizationEndForContract('c.id', 'c.contract_id');
    expect(sql).toContain('trucking_realizations');
    expect(sql).toContain('realization_end_date');
    expect(sql).toContain('Trucking Last Receive Date');
    expect(sql).not.toContain('t.trucking_completion_date');
    expect(sql).toContain('MM/DD/YYYY');
  });

  it('sqlMinTruckingRealizationStartForContract uses extension then SAP AV', () => {
    const sql = sqlMinTruckingRealizationStartForContract('c.id', 'c.contract_id');
    expect(sql).toContain('realization_start_date');
    expect(sql).toContain('Trucking Start Receive Date');
    expect(sql).not.toContain('t.trucking_start_date');
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
