import { describe, expect, it } from 'vitest';
import { buildShipmentStageSnapshotInsertSql } from './shipmentPipelineDailySummarySql';

describe('buildShipmentStageSnapshotInsertSql', () => {
  it('includes delivery qty columns for Delivery Qty → PLANNED status', () => {
    const sql = buildShipmentStageSnapshotInsertSql();
    expect(sql).toContain('quantity_delivered');
    expect(sql).toContain('quantity_delivered_klip');
    expect(sql).toContain('master_vessel_id');
    expect(sql).toContain('COALESCE(c_origin.id, c_link.id)');
    expect(sql).toContain('cs_sto.contract_id = c_link.id');
  });
});
