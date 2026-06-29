import { describe, expect, it } from 'vitest';
import { buildOilLossMainSql } from './oilLossQuerySql';

describe('buildOilLossMainSql', () => {
  it('resolves qty from shipments when manual differs from SAP', () => {
    const sql = buildOilLossMainSql();
    expect(sql).toContain('oil_loss_closed');
    expect(sql).toContain('shipment_qty_delivered_kg');
    expect(sql).toContain('shipment_qty_receive_kg');
    expect(sql).toContain('with_qty');
    expect(sql).toContain('qty_delivery_resolved');
    expect(sql).toContain('qty_receive_resolved');
    expect(sql).toContain('qty_receive_resolved < qty_delivery_resolved');
    expect(sql).toContain('ABS');
  });
});
