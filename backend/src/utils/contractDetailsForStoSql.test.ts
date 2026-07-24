import { describe, expect, it } from 'vitest';
import {
  buildContractDetailsForStoSql,
  sqlSiblingShipmentKlipQtyExpr,
} from './contractDetailsForStoSql';

describe('sqlSiblingShipmentKlipQtyExpr', () => {
  it('reads KLIP delivered/receive from sibling shipment under lookup key', () => {
    const delivered = sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'delivered');
    expect(delivered).toContain('quantity_delivered_klip');
    expect(delivered).toContain('operation_id');
    expect(delivered).toContain('shipment_id');
    expect(delivered).toContain('pl.contract_number');
    const receive = sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'receive');
    expect(receive).toContain('actual_vessel_qty_receive');
  });
});

describe('buildContractDetailsForStoSql', () => {
  it('discovers contracts by sto_number and returns one row per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('c.sto_number::text');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('po_lines');
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('pl.incoterm');
    expect(sql).toContain('pl.contract_qty');
    expect(sql).toContain('Quantity Delivery Vessel');
    expect(sql).toContain("~ '^(OP-|MNL-|MSEA-)'");
    expect(sql).toContain("'Operation ID'");
    expect(sql).not.toContain('qty_move');
    expect(sql).toContain('po_number::text');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("IN ('SEA', 'MIXED', 'MIX')");
    // Blank-STO fallback must be contract-scoped (Edit Shipment PO list), not global discover.
    expect(sql).toContain('spd.contract_number = pl.contract_number');
    expect(sql).toContain('AS quantity_delivered_klip');
    expect(sql).toContain('AS quantity_receive_klip');
  });

  it('uses shared STO+PO scoped delivery/receive SQL per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('$1::text');
    expect(sql).toContain('Quantity Delivery Vessel');
    expect(sql).toContain('Quantity Receive');
    expect(sql).toContain('SUM(');
  });

  it('excludes B2B child PO lines (Contract Reff PO set)', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('latest_spd_b2b');
    expect(sql).toContain("= 'B2B'");
    expect(sql).toContain('contract_reference_po');
    expect(sql).toContain('LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = pl.contract_number');
  });
});
