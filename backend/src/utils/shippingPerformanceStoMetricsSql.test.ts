import { describe, expect, it } from 'vitest';
import {
  buildShipmentListStoMetricsCte,
  buildShippingPerfStoMetricsCte,
} from './shippingPerformanceStoMetricsSql';

describe('shippingPerformanceStoMetricsSql', () => {
  it('computes actual outstanding from Contract Qty with Open/Close KLIP overlay', () => {
    const sql = buildShippingPerfStoMetricsCte();

    expect(sql).toContain('sto_shipment_klip');
    expect(sql).toContain('quantity_delivered_klip');
    expect(sql).toContain('SUM(po.contract_qty)');
    expect(sql).toContain('SUM(po.os_base_kg)');
    expect(sql).toContain('po_sto_count');
    expect(sql).toContain('AS outstanding_qty_actual');
    expect(sql).toMatch(/outstanding_qty_actual[\s\S]*?SUM\(po\.os_base_kg\)|SUM\(po\.os_base_kg\)[\s\S]*?outstanding_qty_actual/);
  });

  it('uses STO+PO scoped SAP qty in sto_po_lines (matches Edit Shipment modal)', () => {
    const sql = buildShipmentListStoMetricsCte();

    expect(sql).toContain('sto_po_lines');
    expect(sql).toContain('asp.sto_key');
    expect(sql).toContain('asp.po_number');
    expect(sql).toContain('asp.contract_id');
    expect(sql).toContain('Quantity Delivery Vessel');
    expect(sql).toContain('Quantity Receive');
    expect(sql).not.toContain('latest_spd_by_sto_contract');
    expect(sql).not.toContain('lspd_c ON TRUE');
  });

  it('dedupes KLIP qty per contract before summing at STO level (no MNL double-count)', () => {
    const sql = buildShipmentListStoMetricsCte();

    expect(sql).toContain('DISTINCT ON (raw.sto_key, raw.contract_id)');
    expect(sql).toContain('updated_at DESC NULLS LAST');
    expect(sql).toContain('actual_vessel_qty_receive');
  });

  it('STO 1016010610 pattern: excludes B2B child PO and SAP-only phantom contract', () => {
    const sql = buildShipmentListStoMetricsCte();
    const linksSection = sql.slice(
      sql.indexOf('all_sto_contract_links'),
      sql.indexOf('contract_sto_planning'),
    );

    expect(sql).toContain("= 'B2B'");
    expect(sql).toContain('contract_reference_po');
    expect(linksSection).not.toContain('sap_processed_data');
  });
});
