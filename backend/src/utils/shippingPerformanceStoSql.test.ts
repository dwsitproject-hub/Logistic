import { describe, expect, it } from 'vitest';
import {
  hasKlipShipmentPlanning,
  shippingPerfOperationalStoKeyExpr,
  shippingPerfStoGroupKeyFromRow,
} from './shippingPerformanceStoSql';

describe('shippingPerformanceStoSql', () => {
  it('builds SQL that prefers SAP contract STO when unplanned', () => {
    const sql = shippingPerfOperationalStoKeyExpr('c', 's');
    expect(sql).toContain('c.sto_number');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('daily_deliverables');
    expect(sql).toContain('operation_id');
    expect(sql.indexOf('c.sto_number')).toBeLessThan(sql.lastIndexOf('s.shipment_id'));
  });

  it('detects KLIP planning from operation_id or daily deliverables', () => {
    expect(hasKlipShipmentPlanning({ operation_id: 'OP-SEA-1' })).toBe(true);
    expect(
      hasKlipShipmentPlanning({
        daily_deliverables: [{ date: '2026-01-01', quantity_delivered: 100 }],
      }),
    ).toBe(true);
    expect(hasKlipShipmentPlanning({ shipment_id: 'MNL-123', daily_deliverables: [] })).toBe(true);
    expect(hasKlipShipmentPlanning({ shipment_id: '1006017437', daily_deliverables: [] })).toBe(false);
  });

  it('groups unplanned rows by SAP STO key, not mismatched shipment_id', () => {
    expect(
      shippingPerfStoGroupKeyFromRow({
        sto_key: '1006017941',
        shipment_id: '1006017437',
        sto_number: '1006017941',
        daily_deliverables: [],
      }),
    ).toBe('sto:1006017941');
  });

  it('groups planned rows by operation_id', () => {
    expect(
      shippingPerfStoGroupKeyFromRow({
        sto_key: 'OP-SEA-99',
        operation_id: 'OP-SEA-99',
        shipment_id: '1006017437',
        sto_number: '1006017941',
        daily_deliverables: [],
      }),
    ).toBe('op:OP-SEA-99');
  });
});
