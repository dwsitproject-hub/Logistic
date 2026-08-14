import { describe, expect, it } from 'vitest';
import {
  buildShipmentExcludeStoTypeTSql,
  buildShipmentPageSeaRowScopeSql,
  buildShipmentSeaMixTransportSql,
  contractHasSeaVesselStoOnContractSql,
  contractSeaVesselStoNumberPickExpr,
  isSyntheticShipmentOperationKeySql,
  sapStoNumberKeyExpr,
  sapStoTypeNormalizedExpr,
  shipmentListStoKeyExpr,
  shipmentListDisplayStoNumberExpr,
  shipmentListSeaStoKeyExpr,
  shipmentListSeaDisplayStoNumberExpr,
  shipmentResolvedStoTypeExpr,
  shipmentResolvedStoTypeForNumberExpr,
  shipmentSapStoKeyExpr,
  sqlIsSapSeaStoRowExpr,
  sqlIsSapSeaStoRowForIncotermExpr,
  contractHasFobSeaEligibleStoExistsSql,
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
    expect(sql).toContain("spd_sto_num.data->'raw'->>'STO Type'");
    expect(sql).toContain('c.sto_number');
  });

  it('shipmentResolvedStoTypeForNumberExpr binds a specific STO param', () => {
    const sql = shipmentResolvedStoTypeForNumberExpr('c', '$7::text');
    expect(sql).toContain('$7::text');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('spd_sto_num');
  });

  it('buildShipmentExcludeStoTypeTSql excludes STO Type T', () => {
    const sql = buildShipmentExcludeStoTypeTSql('c', 'l', 's');
    expect(sql).toContain("= 'T')");
    expect(sql).toContain('NOT (');
  });

  it('buildShipmentPageSeaRowScopeSql is CIF/FOB/CFR incoterm and excludes all FOB Type T legs', () => {
    const sql = buildShipmentPageSeaRowScopeSql('c', 'l', 's');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("= 'FOB'");
    expect(sql).toContain("= 'T'");
    expect(sql).toContain('AND NOT');
    expect(sql).not.toContain('vessel_name');
    expect(sql).not.toContain(contractHasSeaVesselStoOnContractSql('c'));
  });

  it('buildShipmentPageSeaRowScopeSql uses selected STO param for FOB type when provided', () => {
    const sql = buildShipmentPageSeaRowScopeSql('c', 'l', 's', { selectedStoParamIndex: 5 });
    expect(sql).toContain('$5::text');
    expect(sql).toContain('spd_sto_num');
  });

  it('contractHasSeaVesselStoOnContractSql picks Type V from contract_stos or SAP', () => {
    const pick = contractSeaVesselStoNumberPickExpr('c');
    const sql = contractHasSeaVesselStoOnContractSql('c');
    expect(pick).toContain("= 'V'");
    expect(pick).toContain('contract_stos');
    expect(pick).toContain('sap_processed_data');
    expect(sql).toContain(pick.trim());
  });

  it('shipmentListSeaStoKeyExpr prefers Type V STO for FOB vessel rows', () => {
    const sql = shipmentListSeaStoKeyExpr('c', 'l', 's');
    expect(sql).toContain("= 'FOB'");
    expect(sql).toContain('vessel_name');
    expect(sql).toContain(contractSeaVesselStoNumberPickExpr('c').trim());
    expect(sql).toContain(shipmentListStoKeyExpr('c', 'l', 's').trim());
  });

  it('shipmentListSeaDisplayStoNumberExpr wraps sea sto key', () => {
    const sql = shipmentListSeaDisplayStoNumberExpr('c', 'l', 's');
    expect(sql).toContain('NULLIF(TRIM');
    expect(sql).toContain("= 'FOB'");
  });

  it('sqlIsSapSeaStoRowExpr matches Type V or non-T rows with vessel name', () => {
    const sql = sqlIsSapSeaStoRowExpr('spd');
    expect(sql).toContain("= 'V'");
    expect(sql).toContain("IS DISTINCT FROM 'T'");
    expect(sql).toContain('Vessel Name');
  });

  it('sqlIsSapSeaStoRowForIncotermExpr passes CIF/CFR and gates FOB to sea leg', () => {
    const sql = sqlIsSapSeaStoRowForIncotermExpr('spd', 'c');
    expect(sql).toContain("IN ('CIF', 'CFR')");
    expect(sql).toContain("'FOB'");
    expect(sql).toContain("= 'V'");
  });

  it('contractHasFobSeaEligibleStoExistsSql checks FOB Type V SPD rows', () => {
    const sql = contractHasFobSeaEligibleStoExistsSql('c');
    expect(sql).toContain('EXISTS');
    expect(sql).toContain("= 'FOB'");
    expect(sql).toContain("= 'V'");
    expect(sql).toContain('spd_fob');
  });
});
