import { describe, expect, it } from 'vitest';
import {
  SHIPMENTS_PAGE_SAP_STO_TYPE_V,
  buildSapStoTypeVExistsForStoParamSql,
  buildSapStoTypeVExistsSql,
  sapStoTypeNormalizedExpr,
} from './shipmentStoTypeSql';

describe('shipmentStoTypeSql', () => {
  it('normalizes STO Type from SAP raw JSON paths', () => {
    expect(sapStoTypeNormalizedExpr('spd')).toContain("spd.data->'raw'->>'STO Type'");
    expect(sapStoTypeNormalizedExpr('spd')).toContain("spd.data->'shipment'->>'sto_type'");
  });

  it('builds EXISTS filter for vessel STO type only', () => {
    const sql = buildSapStoTypeVExistsSql();
    expect(sql).toContain('EXISTS');
    expect(sql).toContain(`= '${SHIPMENTS_PAGE_SAP_STO_TYPE_V}'`);
    expect(sql).toContain('s.shipment_id');
    expect(sql).toContain('c.contract_id');
  });

  it('builds parameterized STO guard for modal endpoints', () => {
    const sql = buildSapStoTypeVExistsForStoParamSql('$1');
    expect(sql).toContain('$1');
    expect(sql).toContain(`= '${SHIPMENTS_PAGE_SAP_STO_TYPE_V}'`);
  });
});
