import { describe, expect, it } from 'vitest';
import {
  buildShipmentExcludeStoTypeTSql,
  buildShipmentPageSeaRowScopeSql,
  buildShipmentSeaMixTransportSql,
  isSyntheticShipmentOperationKeySql,
  sapStoNumberKeyExpr,
  sapStoTypeNormalizedExpr,
  shipmentListStoKeyExpr,
  shipmentListDisplayStoNumberExpr,
  shipmentResolvedStoTypeExpr,
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

  it('prefers distinct numeric shipment_id before contract sto_number for list key', () => {
    const sql = shipmentListStoKeyExpr('c', 'l', 's');
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('c.sto_number::text');
    expect(sql.indexOf('s.shipment_id::text')).toBeLessThan(sql.indexOf('c.sto_number::text'));
  });

  it('display STO expr prefers distinct numeric shipment_id before contract sto_number', () => {
    const sql = shipmentListDisplayStoNumberExpr('c', 'l', 's');
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('c.sto_number::text');
    expect(sql.indexOf('s.shipment_id::text')).toBeLessThan(sql.indexOf('c.sto_number::text'));
    expect(sql).not.toContain('operation_id');
  });

  it('keeps legacy shipmentSapStoKeyExpr for contract sto first', () => {
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

  it('scopes shipments to SEA/MIX transport (legacy helper; list uses incoterm)', () => {
    expect(buildShipmentSeaMixTransportSql('c')).toContain("IN ('SEA', 'MIX')");
  });

  it('resolves STO Type from contract_stos and SAP fallback', () => {
    const sql = shipmentResolvedStoTypeExpr('c', 'l', 's');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('l.effective_sto');
    expect(sql).toContain("spd_sto_type.data->'raw'->>'STO Type'");
  });

  it('buildShipmentExcludeStoTypeTSql excludes STO Type T', () => {
    const sql = buildShipmentExcludeStoTypeTSql('c', 'l', 's');
    expect(sql).toContain("= 'T')");
    expect(sql).toContain('NOT (');
  });

  it('buildShipmentPageSeaRowScopeSql is CIF/FOB/CFR incoterm only (no STO Type T filter)', () => {
    const sql = buildShipmentPageSeaRowScopeSql('c', 'l', 's');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).not.toMatch(/=\s*'T'/);
    expect(sql).not.toContain(' AND ');
  });
});
