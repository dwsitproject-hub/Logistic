import { describe, expect, it } from 'vitest';
import {
  buildTruckingPageLandTransportSql,
  buildTruckingPageListScopeSql,
  contractEffectiveSeaLandExpr,
} from './truckingStoTypeSql';

describe('truckingStoTypeSql', () => {
  it('resolves effective Sea/Land from contract with SAP fallback', () => {
    const sql = contractEffectiveSeaLandExpr('c');
    expect(sql).toContain('c.transport_mode');
    expect(sql).toContain('Sea / Land');
    expect(sql).toContain('sap_processed_data');
  });

  it('trucking list scope is LAND transport only', () => {
    const sql = buildTruckingPageListScopeSql();
    expect(sql).toContain("= 'LAND'");
    expect(sql).not.toContain('STO Type');
    expect(sql).not.toContain('sap_sto_type_t');
  });

  it('supports custom contract alias for land transport guard', () => {
    const sql = buildTruckingPageLandTransportSql('contracts');
    expect(sql).toContain('contracts.transport_mode');
    expect(sql).toContain("= 'LAND'");
  });
});
