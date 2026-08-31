import { describe, expect, it } from 'vitest';
import {
  CONTRACT_REAL_STO_KEYS_SQL,
  CONTRACT_SAP_ONLY_STOS_SQL,
  sqlSapQtyDeliveredAnyFromSpd,
  sqlSapQtyDeliveredForStoKeyExpr,
  sqlSapQtyDeliveredKgFromSpd,
  sqlSapQtyReceiveForStoKeyExpr,
  sqlSapStoKeyMatchExpr,
  sqlSapStoQtyForContractPoExpr,
  sqlStoLookupKeyMatchExpr,
  sqlStoScopedDeliveredKgSql,
  sqlStoScopedReceiveKgSql,
} from './contractLogisticsStoDetailSql';

describe('contractLogisticsStoDetailSql', () => {
  it('includes SAP trucking delivery field aliases', () => {
    const expr = sqlSapQtyDeliveredAnyFromSpd('spd');
    expect(expr).toContain('Quantity Delivery Trucking');
    expect(expr).toContain('Quantity Delivered Trucking');
    expect(expr).toContain('quantity_delivery_trucking');
  });

  it('includes SAP vessel delivery field aliases', () => {
    const expr = sqlSapQtyDeliveredAnyFromSpd('spd');
    expect(expr).toContain('Quantity Delivery Vessel');
    expect(expr).toContain('Quantity Delivered');
  });

  it('uses incoterm matrix so CIF prefers vessel over dirty trucking', () => {
    const expr = sqlSapQtyDeliveredAnyFromSpd('spd', 'c.incoterm');
    expect(expr).toContain("'CIF'");
    expect(expr).toContain("'FOB'");
    expect(expr).toContain("'FRC'");
    expect(expr).toContain('c.incoterm');
    // Must not prefer trucking via bare COALESCE(NULLIF(trucking), vessel)
    expect(expr).not.toMatch(/COALESCE\(\s*NULLIF\(\s*\([^)]*Quantity Delivery Trucking/);
  });

  it('normalizes MT-scale SAP delivery to kg', () => {
    const expr = sqlSapQtyDeliveredKgFromSpd('spd2', 'c.quantity_ordered', 'c.incoterm');
    expect(expr).toContain('* 1000');
    expect(expr).toContain('quantity_ordered');
    expect(expr).toContain('c.incoterm');
  });

  it('builds SAP STO qty by PO without falling back to contract quantity_ordered', () => {
    const expr = sqlSapStoQtyForContractPoExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(expr).toContain("->>'STO Quantity'");
    expect(expr).toContain('po_number');
    expect(expr).toContain('OP-|MNL-|MSEA-');
    expect(expr).not.toContain('quantity_ordered');
  });

  it('matches Operation ID keys to SAP rows by PO when STO/Operation ID is null', () => {
    const match = sqlSapStoKeyMatchExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(match).toContain('OP-|MNL-|MSEA-');
    expect(match).toContain('po_number');
    expect(match).toContain('Operation ID');
    expect(match).toContain('IS NULL');
  });

  it('sqlStoLookupKeyMatchExpr does not blank-match OP keys without contract scope', () => {
    const discover = sqlStoLookupKeyMatchExpr('$1::text', 'spd');
    expect(discover).toContain('Operation ID');
    expect(discover).toContain("~ '^(OP-|MNL-|MSEA-)'");
    // Global discover must not treat every empty-STO SAP row as a hit.
    expect(discover).not.toMatch(/OP-\|MNL-\|MSEA-'[\s\S]*IS NULL/);
  });

  it('sqlStoLookupKeyMatchExpr allows blank STO only when scoped to a contract', () => {
    const scoped = sqlStoLookupKeyMatchExpr('$1::text', 'spd', {
      contractNumberExpr: 'pl.contract_number',
    });
    expect(scoped).toContain('spd.contract_number = pl.contract_number');
    expect(scoped).toContain('IS NULL');
  });

  it('builds SAP delivery/receive qty for Operation ID fallback by PO', () => {
    const delivered = sqlSapQtyDeliveredForStoKeyExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
      contractQtyExpr: 'c.quantity_ordered',
    });
    const receive = sqlSapQtyReceiveForStoKeyExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(delivered).toContain('Quantity Delivery Trucking');
    expect(delivered).toContain('OP-|MNL-|MSEA-');
    expect(delivered).toContain('c.incoterm');
    expect(delivered).toContain("'CIF'");
    expect(receive).toContain('Quantity Receive');
    expect(receive).toContain('po_number');
  });

  it('sqlStoScopedDeliveredKgSql filters by STO key, contract, and PO', () => {
    const sql = sqlStoScopedDeliveredKgSql({
      contractNumberExpr: 'asp.contract_id',
      contractQtyExpr: 'asp.contract_qty',
      stoKeyExpr: 'asp.sto_key',
      poNumberExpr: 'asp.po_number',
    });
    expect(sql).toContain('asp.sto_key');
    expect(sql).toContain('asp.contract_id');
    expect(sql).toContain('asp.po_number');
    expect(sql).toContain('Quantity Delivery Vessel');
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('created_at DESC');
    expect(sql).toContain("'CIF'");
  });

  it('CONTRACT_SAP_ONLY_STOS_SQL exposes SEA ATA loading for contract STO table', () => {
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('ATA Vessel Arrival at Loading Port');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('ata_arrival_loading');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('eta_discharge_complete');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('sap_trucking_start_receive_date');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('NULL::date AS daily_plan_start_date');
  });

  it('CONTRACT_SAP_ONLY_STOS_SQL scopes qty by contract/PO helpers (not STO-wide SUM)', () => {
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('po_number');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('CROSS JOIN contracts c_po');
    expect(CONTRACT_SAP_ONLY_STOS_SQL).toContain('c_po.id = $1');
    // Must not reintroduce unscoped SUM across all POs on the same STO.
    expect(CONTRACT_SAP_ONLY_STOS_SQL).not.toMatch(
      /FROM sap_processed_data spd2\s+WHERE NULLIF\(TRIM\(COALESCE\(spd2\.sto_number/,
    );
  });

  it('CONTRACT_REAL_STO_KEYS_SQL unions contract_stos and SAP by contract/PO', () => {
    expect(CONTRACT_REAL_STO_KEYS_SQL).toContain('contract_stos');
    expect(CONTRACT_REAL_STO_KEYS_SQL).toContain('sap_processed_data');
    expect(CONTRACT_REAL_STO_KEYS_SQL).toContain('c3.po_number');
    expect(CONTRACT_REAL_STO_KEYS_SQL).toContain('cs.contract_id = $1');
  });
});
