import { describe, expect, it } from 'vitest';
import {
  TRUCKING_QTY_RESOLUTION_JOIN,
  TRUCKING_QTY_RESOLUTION_OVERRIDES,
} from './truckingPoQtyResolutionCteSql';

describe('truckingPoQtyResolutionCteSql B2B overlay', () => {
  it('joins qty_move snapshot on SAP contract_id (not UUID)', () => {
    expect(TRUCKING_QTY_RESOLUTION_JOIN).toContain(
      'LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id',
    );
  });

  it('overlays parent SAP NULL/0 with snapshot (never parent+child)', () => {
    expect(TRUCKING_QTY_RESOLUTION_OVERRIDES.sapDeliveryExpr).toContain(
      'COALESCE(NULLIF(spq_d.qty_kg, 0), qm.quantity_delivery_trucking)',
    );
    expect(TRUCKING_QTY_RESOLUTION_OVERRIDES.sapReceiveExpr).toContain(
      'COALESCE(NULLIF(spq_r.qty_kg, 0), qm.quantity_receive)',
    );
    expect(TRUCKING_QTY_RESOLUTION_OVERRIDES.sapDeliveryExpr).not.toContain('spq_d.qty_kg +');
    expect(TRUCKING_QTY_RESOLUTION_OVERRIDES.sapReceiveExpr).not.toContain('spq_r.qty_kg +');
  });
});
