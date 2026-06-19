import { describe, expect, it } from 'vitest';
import {
  isSyntheticShipmentOperationKeySql,
  sapStoNumberKeyExpr,
  sapStoTypeNormalizedExpr,
  shipmentSapStoKeyExpr,
} from './shipmentStoTypeSql';

describe('shipmentStoTypeSql', () => {
  it('normalizes STO Type from SAP raw JSON paths', () => {
    expect(sapStoTypeNormalizedExpr('spd')).toContain("spd.data->'raw'->>'STO Type'");
    expect(sapStoTypeNormalizedExpr('spd')).toContain("spd.data->'shipment'->>'sto_type'");
  });

  it('extracts STO number from SAP JSON paths', () => {
    expect(sapStoNumberKeyExpr('spd')).toContain("spd.data->'raw'->>'STO No.'");
    expect(sapStoNumberKeyExpr('spd')).toContain('spd.sto_number');
  });

  it('prefers contract/SAP STO before synthetic shipment keys', () => {
    expect(shipmentSapStoKeyExpr).toContain('c.sto_number');
    expect(shipmentSapStoKeyExpr).toContain('l.effective_sto');
    expect(shipmentSapStoKeyExpr.indexOf('c.sto_number')).toBeLessThan(
      shipmentSapStoKeyExpr.indexOf('s.operation_id'),
    );
  });

  it('detects synthetic OP-* operation keys', () => {
    const sql = isSyntheticShipmentOperationKeySql('sb.sto_key');
    expect(sql).toContain("^OP-");
    expect(sql).toContain('sb.sto_key');
  });
});
