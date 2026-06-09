import { describe, expect, it } from 'vitest';
import {
  TRUCKING_PAGE_SAP_STO_TYPE_T,
  buildSapStoTypeTExistsForContractSql,
  buildTruckingSapStoTypeTExistsSql,
} from './truckingStoTypeSql';

describe('truckingStoTypeSql', () => {
  it('builds trucking EXISTS filter for STO Type T', () => {
    const sql = buildTruckingSapStoTypeTExistsSql();
    expect(sql).toContain('EXISTS');
    expect(sql).toContain(`= '${TRUCKING_PAGE_SAP_STO_TYPE_T}'`);
    expect(sql).toContain('c.sto_number');
    expect(sql).toContain('s.shipment_id');
  });

  it('builds contract-level T guard for suggestions modal', () => {
    const sql = buildSapStoTypeTExistsForContractSql();
    expect(sql).toContain('c.contract_id');
    expect(sql).toContain(`= '${TRUCKING_PAGE_SAP_STO_TYPE_T}'`);
  });
});
