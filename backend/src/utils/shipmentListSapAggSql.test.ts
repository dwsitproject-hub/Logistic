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
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain(SHIPMENT_LIST_SPD_AGG_CTES_FULL.trim().slice(0, 40));
    expect(full).toContain('contract_ext_agg');
    expect(full).toContain('quantity_delivered_sap');
    expect(full).toContain('vessel_name_sap');
    expect(full).toContain('sap_vessel_pick');
    expect(full).toContain('sap_loading_ports_agg');
    expect(full).toContain('sto_po_lines');
  });

  it('guards contract fallback so multi-STO contracts cannot contaminate page STO', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain("~ '^OP-'");
    expect(full).toMatch(/OR\s+[\s\S]*?IS NULL\s+OR\s+[\s\S]*?=\s*TRIM\(sp\.sto_key::text\)/);
    expect(full).toContain('multi-STO contracts');
  });
});
