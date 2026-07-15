import { describe, expect, it } from 'vitest';
import { buildShippingPerfStoMetricsCte } from './shippingPerformanceStoMetricsSql';

describe('shippingPerformanceStoMetricsSql', () => {
  it('treats missing SAP movement as zero when calculating actual outstanding', () => {
    const sql = buildShippingPerfStoMetricsCte();

    expect(sql).toContain('COALESCE(po.receive_kg, 0)');
    expect(sql).toContain('COALESCE(po.delivery_kg, 0)');
    expect(sql).toContain('AS outstanding_qty_actual');
  });
});
