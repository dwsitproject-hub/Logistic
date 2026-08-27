/**
 * Regression lock: hydrate list SQL must keep OS / receive / delivery formulas.
 * Compact skipSapJoin shell must not compute those columns (UI shows placeholders until hydrate).
 */
import { describe, expect, it } from 'vitest';
import { buildShipmentListPageQuery } from '../services/shipmentList.service';
import type { ShipmentListQueryContext } from '../services/shipmentList.service';
import {
  shipmentListPageQtySelectSql,
} from './shipmentListQtySql';
import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';

function listCtx(overrides: Partial<ShipmentListQueryContext>): ShipmentListQueryContext {
  return {
    shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
    outerSql: '',
    innerParams: [],
    outerParams: [],
    skipSapJoin: false,
    cacheKey: 'qty-regress',
    filterCacheKey: 'qty-regress-filter',
    sortKey: 'created_at',
    sortDir: 'DESC',
    ...overrides,
  };
}

describe('shipment list OS / receive / delivery regression', () => {
  it('hydrate SELECT embeds shipmentListPageQtySelectSql (OS, receive, SAP delivery)', () => {
    const qtySelect = shipmentListPageQtySelectSql('sp');
    const hydrate = buildShipmentListPageQuery(listCtx({ skipSapJoin: false }), 20, 0).text;
    expect(hydrate).toContain(qtySelect);
    expect(qtySelect).toContain('AS outstanding_quantity');
    expect(qtySelect).toContain('AS quantity_receive');
    expect(qtySelect).toContain('AS quantity_delivered_sap');
    expect(qtySelect).toContain('sm.po_sto_count');
  });

  it('OS repeats PO-level qty_move outstanding when the PO has more than one STO', () => {
    const hydrate = buildShipmentListPageQuery(listCtx({ skipSapJoin: false }), 20, 0).text;
    expect(hydrate).toContain('sm.po_sto_count');
    expect(hydrate).toContain('WHEN COALESCE((sm.po_sto_count)::int, 1) > 1');
    expect(hydrate).not.toContain(
      'THEN COALESCE(NULLIF((COALESCE(sm.sto_qty, sa.sto_quantity))::numeric, 0)',
    );
  });

  it('hydrate keeps Open→KLIP / Close→SAP receive and delivery resolve', () => {
    const hydrate = buildShipmentListPageQuery(listCtx({ skipSapJoin: false }), 20, 0).text;
    const receive = sqlShipmentResolvedReceiveKg(
      'COALESCE(sp.is_contract_sap_closed, FALSE)',
      'sp.actual_vessel_qty_receive',
      'PLACEHOLDER',
    );
    const delivery = sqlShipmentResolvedDeliveryKg(
      'COALESCE(sp.is_contract_sap_closed, FALSE)',
      'sp.quantity_delivered_klip',
      'PLACEHOLDER',
      'sp.quantity_delivered',
    );
    expect(hydrate).toContain('COALESCE(sp.is_contract_sap_closed, FALSE)');
    expect(hydrate).toContain('sm.klip_receive_kg');
    expect(hydrate).toContain('sp.actual_vessel_qty_receive');
    expect(hydrate).toContain('sm.klip_delivery_kg');
    expect(hydrate).toContain('sp.quantity_delivered_klip');
    expect(receive).toContain('IS TRUE THEN');
    expect(delivery).toContain('IS TRUE THEN');
  });

  it('CIF/CFR/FRC OS uses receive; FOB/LCO uses delivery', () => {
    const hydrate = buildShipmentListPageQuery(listCtx({ skipSapJoin: false }), 20, 0).text;
    expect(hydrate).toContain("IN ('FRC', 'CIF', 'CFR')");
    expect(hydrate).toContain("IN ('LCO', 'FOB')");
  });

  it('shell SQL does not embed qty select so hydrate is the only OS/receive/delivery source', () => {
    const qtySelect = shipmentListPageQtySelectSql('sp');
    const shell = buildShipmentListPageQuery(listCtx({ skipSapJoin: true }), 20, 0).text;
    expect(shell).not.toContain(qtySelect);
    expect(shell).not.toMatch(/\bqty_move\b/);
    expect(shell).not.toMatch(/LEFT JOIN sto_metrics\b/);
  });

  it('qty-sort path still hydrates OS even if skipSapJoin is requested on the context', () => {
    const qtySelect = shipmentListPageQtySelectSql('fs');
    const q = buildShipmentListPageQuery(
      listCtx({ skipSapJoin: true, sortKey: 'outstanding_quantity', sortDir: 'ASC' }),
      20,
      0,
    ).text;
    expect(q).toContain('list_enriched AS');
    expect(q).toContain(qtySelect);
    expect(q).toContain('le.outstanding_quantity ASC');
  });
});
