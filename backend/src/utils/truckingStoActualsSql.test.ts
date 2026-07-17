import { describe, expect, it } from 'vitest';
import { sqlTruckingStoActualsByContractId } from './truckingStoActualsSql';

describe('truckingStoActualsSql', () => {
  it('builds per-STO SAP dates and qty select for a contract uuid', () => {
    const sql = sqlTruckingStoActualsByContractId();
    expect(sql).toContain('sto_keys');
    expect(sql).toContain('sap_trucking_start_receive_date');
    expect(sql).toContain('sap_trucking_last_receive_date');
    expect(sql).toContain('sap_qty_delivery');
    expect(sql).toContain('sap_qty_receive');
    expect(sql).toContain('c.id = $1');
  });
});
