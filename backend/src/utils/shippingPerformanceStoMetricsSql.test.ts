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
    expect(sql).toContain('AS outstanding_qty_actual');
    // OS base must be Contract Qty, not STO Qty
    expect(sql).toMatch(/outstanding_qty_actual[\s\S]*?SUM\(po\.contract_qty\)|SUM\(po\.contract_qty\)[\s\S]*?outstanding_qty_actual/);
  });

  it('falls back to latest SAP by contract when sto_key match is missing (null STO)', () => {
    const sql = buildShipmentListStoMetricsCte();

    expect(sql).toContain('COALESCE(lspd.receive_kg, lspd_c.receive_kg)');
    expect(sql).toContain('COALESCE(lspd.delivery_kg, lspd_c.delivery_kg)');
    // Contract-level fallback is a LATERAL latest-SAP-row lookup (was a DISTINCT ON CTE).
    expect(sql).toContain(') lspd_c ON TRUE');
    expect(sql).toContain("TRIM(spd.contract_number) = TRIM(asp.contract_id)");
  });
});
