import { describe, expect, it } from 'vitest';
import {
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

  it('normalizes MT-scale SAP delivery to kg', () => {
    const expr = sqlSapQtyDeliveredKgFromSpd('spd2', 'c.quantity_ordered');
    expect(expr).toContain('* 1000');
    expect(expr).toContain('quantity_ordered');
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
  });

  it('sqlStoScopedReceiveKgSql filters by STO key, contract, and PO', () => {
    const sql = sqlStoScopedReceiveKgSql({
      contractNumberExpr: 'pl.contract_number',
      contractQtyExpr: 'pl.contract_qty',
      stoKeyExpr: '$1::text',
      poNumberExpr: 'pl.po_number',
    });
    expect(sql).toContain('$1::text');
    expect(sql).toContain('pl.contract_number');
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('Quantity Receive');
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('created_at DESC');
  });
});
