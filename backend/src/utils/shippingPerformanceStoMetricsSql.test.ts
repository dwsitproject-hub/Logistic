import { describe, expect, it } from 'vitest';
import {
  buildShipmentListStoMetricsCte,
  buildShippingPerfStoMetricsCte,
} from './shippingPerformanceStoMetricsSql';

describe('shippingPerformanceStoMetricsSql', () => {
  it('treats missing SAP movement as zero when calculating actual outstanding', () => {
    const sql = buildShippingPerfStoMetricsCte();

    expect(sql).toContain('COALESCE(po.receive_kg, 0)');
    expect(sql).toContain('COALESCE(po.delivery_kg, 0)');
    expect(sql).toContain('AS outstanding_qty_actual');
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
