import { describe, expect, it } from 'vitest';
import {
  sqlTruckingEligibleStoLineWhere,
  sqlTruckingStoHasSapMovement,
} from './truckingListStoEligibleSql';

describe('truckingListStoEligibleSql', () => {
  it('shell mode uses primary STO or sole contract_stos only', () => {
    const sql = sqlTruckingEligibleStoLineWhere('c', 'TRIM(cs.sto_number::text)', true);
    expect(sql).toContain('c.sto_number');
    expect(sql).toContain('contract_stos cs_n');
    expect(sql).not.toContain('sap_processed_data');
  });

  it('full SAP mode adds movement EXISTS predicate', () => {
    const sql = sqlTruckingEligibleStoLineWhere('c', 'TRIM(cs.sto_number::text)', false);
    expect(sql).toContain('sap_processed_data');
    expect(sql).toContain('Trucking Last Receive Date');
  });

  it('movement SQL matches contract and STO', () => {
    const sql = sqlTruckingStoHasSapMovement('c', 'TRIM(cs.sto_number::text)');
    expect(sql).toContain('spd.contract_number');
    expect(sql).toContain('Quantity Delivered');
  });
});
