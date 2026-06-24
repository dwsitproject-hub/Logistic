import { describe, expect, it } from 'vitest';
import {
  buildShipmentKlipProtectedSetSql,
  buildTruckingKlipProtectedSetSql,
  mergeSapNumericColumnSql,
  mergeSapTextColumnSql,
} from './klipSapFieldMerge';

describe('klipSapFieldMerge', () => {
  it('prefers SAP for text when KLIP protection is off', () => {
    expect(mergeSapTextColumnSql('vessel_name', '$4', false)).toContain('COALESCE($4, vessel_name)');
  });

  it('prefers existing KLIP text when protection is on', () => {
    expect(mergeSapTextColumnSql('vessel_name', '$4', true)).toContain(
      "COALESCE(NULLIF(TRIM(vessel_name), ''), $4)",
    );
  });

  it('prefers existing KLIP numeric when protection is on', () => {
    expect(mergeSapNumericColumnSql('quantity_delivered', '$19::numeric', true)).toBe(
      'quantity_delivered = COALESCE(quantity_delivered, $19::numeric)',
    );
  });

  it('builds shipment protected block for ON CONFLICT', () => {
    const sql = buildShipmentKlipProtectedSetSql(true, 'excluded');
    expect(sql).toContain('EXCLUDED.vessel_name');
    expect(sql).toContain('shipments.vessel_code');
    expect(sql).toContain('actual_vessel_qty_receive');
    expect(sql).toContain('port_of_loading');
  });

  it('builds trucking protected block', () => {
    const sql = buildTruckingKlipProtectedSetSql(true);
    expect(sql).toContain('loading_location');
    expect(sql).toContain('quantity_delivered');
  });
});
