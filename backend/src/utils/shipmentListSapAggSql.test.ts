import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_LIST_SPD_AGG_CTES_FULL,
  SHIPMENT_LIST_SPD_AGG_CTES_STUB,
  shipmentListSpdAggCtes,
} from './shipmentListSapAggSql';

describe('shipmentListSapAggSql', () => {
  it('returns stub CTEs when skipSapJoin is true', () => {
    expect(shipmentListSpdAggCtes(true)).toBe(SHIPMENT_LIST_SPD_AGG_CTES_STUB);
  });

  it('returns full SAP aggregation CTEs when skipSapJoin is false', () => {
    expect(shipmentListSpdAggCtes(false)).toBe(SHIPMENT_LIST_SPD_AGG_CTES_FULL);
    expect(shipmentListSpdAggCtes(false)).toContain('contract_ext_agg');
    expect(shipmentListSpdAggCtes(false)).toContain('quantity_delivered_sap');
    expect(shipmentListSpdAggCtes(false)).toContain('vessel_name_sap');
    expect(shipmentListSpdAggCtes(false)).toContain('sap_vessel_pick');
  });
});
