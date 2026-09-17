import { describe, expect, it } from 'vitest';
import {
  sqlTruckingEligibleStoLineWhere,
  sqlTruckingStoHasSapMovement,
} from './truckingListStoEligibleSql';

describe('truckingListStoEligibleSql', () => {
  it('shell mode accepts the primary STO or any registered contract_stos line', () => {
    // Regression: restricting the shell to "primary or sole STO" hid secondary STO
    // lines of multi-STO contracts from the table while the Summary Trucking Status
    // circles (full expansion) counted them (e.g. contract 1004030828: 2 vs 1).
    const sql = sqlTruckingEligibleStoLineWhere('c', 'TRIM(cs.sto_number::text)', true);
    expect(sql).toContain('c.sto_number');
    expect(sql).toContain('contract_stos cs_reg');
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
