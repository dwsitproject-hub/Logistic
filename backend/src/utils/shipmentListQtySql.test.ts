import { describe, expect, it } from 'vitest';
import {
  shipmentListPageQtySelectSql,
  shipmentListRowContractQtySql,
  shipmentListSapReceiveQtySql,
  sqlCoalesceNonZeroChain,
  sqlCoalesceNonZeroQty,
  sqlGroupedMaybeCopiedQty,
  sqlShipmentListOsBaseQtyExpr,
  sqlShipmentListOutstandingKgExpr,
} from './shipmentListQtySql';

describe('sqlCoalesceNonZeroQty', () => {
  it('does not let a 0 preferred value hide the fallback', () => {
    const sql = sqlCoalesceNonZeroQty('sm.delivered_qty', 'sa.quantity_delivered_sap');
    expect(sql).toContain('NULLIF((sm.delivered_qty)::numeric, 0)');
    expect(sql).toContain('sa.quantity_delivered_sap');
  });
});

describe('sqlCoalesceNonZeroChain', () => {
  it('prefers sto_metrics before header SUM so copied vessel totals cannot inflate SAP', () => {
    const sql = sqlCoalesceNonZeroChain(['sm.delivered_qty', 'sp.quantity_delivered']);
    expect(sql).toContain('NULLIF((sm.delivered_qty)::numeric, 0)');
    expect(sql).toContain('sp.quantity_delivered');
    expect(sql).not.toContain('GREATEST(');
  });
});

describe('sqlGroupedMaybeCopiedQty', () => {
  it('keeps MAX when every PO copied the same vessel qty', () => {
    const sql = sqlGroupedMaybeCopiedQty('s.quantity_delivered');
    expect(sql).toContain('THEN MAX(s.quantity_delivered)');
    expect(sql).toContain('ELSE SUM(s.quantity_delivered)');
  });
});

describe('shipmentListRowContractQtySql', () => {
  it('sums quantity_ordered via contract_numbers or sto_key linkage', () => {
    const sql = shipmentListRowContractQtySql('sp');
    expect(sql).toContain('contract_stos cs');
    expect(sql).toContain('sp.sto_key');
  });
});

describe('sqlShipmentListOsBaseQtyExpr', () => {
  it('uses STO qty when the PO has more than one STO', () => {
    const sql = sqlShipmentListOsBaseQtyExpr({
      poStoCountExpr: 'sm.po_sto_count',
      stoQtyExpr: 'sm.sto_qty',
      contractQtyExpr: 'sm.contract_qty',
    });
    expect(sql).toContain('sm.po_sto_count');
    expect(sql).toContain('sm.sto_qty');
    expect(sql).toContain('sm.contract_qty');
    expect(sql).toContain('> 1');
  });
});

describe('sqlShipmentListOutstandingKgExpr', () => {
  it('returns NULL only when contract qty is unknown; null fulfilled counts as 0', () => {
    const sql = sqlShipmentListOutstandingKgExpr({
      contractQtyExpr: 'po.contract_qty',
      incotermExpr: 'po.incoterm',
      receiveExpr: 'po.receive_kg',
      deliveryExpr: 'po.delivery_kg',
      clampAtZero: true,
    });
    expect(sql).toContain('WHEN po.contract_qty IS NULL THEN NULL');
    expect(sql).toContain('COALESCE((CASE');
    expect(sql).not.toContain('WHEN (CASE');
    expect(sql).toContain('GREATEST(0');
  });
});

describe('shipmentListPageQtySelectSql', () => {
  it('prefers Open/Close fulfilled OS over qty_move stubs and sto_metrics last', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).not.toContain('COALESCE(sm.contract_qty, 0)');
    expect(sql).toContain('COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity');
    expect(sql).toContain('qty_move qm');
    expect(sql).toContain('sm.outstanding_qty_actual');
    expect(sql).toContain('COALESCE(sm.contract_qty');
    expect(sql).toContain('quantity_delivered_klip');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).toContain('AS outstanding_quantity');
    expect(sql).toContain('sm.po_sto_count');
    const osAssign = sql.indexOf('AS outstanding_quantity');
    expect(osAssign).toBeGreaterThan(-1);
    expect(sql.indexOf('quantity_delivered_klip')).toBeGreaterThan(-1);
  });

  it('maps hydrated SAP qty from sto_metrics / sap_agg / sto-scoped SAP (not KLIP vessel 0)', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).toContain('sm.delivered_qty');
    expect(sql).toContain('sm.received_qty');
    expect(sql).toContain('sm.klip_receive_kg');
    expect(sql).toContain('AS klip_receive_qty');
    expect(sql).toContain('AS klip_delivery_qty');
    expect(sql).toContain('quantity_delivered_sap');
    expect(sql).toContain('quantity_receive');
    expect(sql).toContain('Quantity Receive');
    expect(sql).toContain('qm.quantity_receive');
    expect(sql).toContain("'^(OP-|MNL-|MSEA-)'");
    const receiveSql = shipmentListSapReceiveQtySql('sp');
    expect(receiveSql).not.toContain('actual_vessel_qty_receive');
    expect(receiveSql).not.toContain('GREATEST(');
  });

  it('repeats PO-level qty_move OS on every sibling STO when po_sto_count > 1', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).toContain('WHEN COALESCE((sm.po_sto_count)::int, 1) > 1');
    expect(sql).toContain('c.quantity_ordered');
    expect(sql).toContain('qm.quantity_receive');
    expect(sql).toContain('AS outstanding_quantity');
    expect(sql).not.toContain(
      'THEN COALESCE(NULLIF((COALESCE(sm.sto_qty, sa.sto_quantity))::numeric, 0)',
    );
  });

  it('uses STO-scoped SAP only (no SPD history SUM) when the PO has several STOs', () => {
    const sql = shipmentListSapReceiveQtySql('sp');
    expect(sql).toContain('COALESCE((sm.po_sto_count)::int, 1) > 1');
    expect(sql).toContain('sm.received_qty');
    expect(sql).toContain('sa.quantity_receive');
    expect(sql).toContain("'^(OP-|MNL-|MSEA-)'");
  });

  it('shipmentListSapReceiveQtySql uses sto-scoped SAP for real STO; qty_move only for synthetic', () => {
    const sql = shipmentListSapReceiveQtySql('sp');
    expect(sql).toContain("'^(OP-|MNL-|MSEA-)'");
    expect(sql).toContain('sm.received_qty');
    expect(sql).toContain('qm.quantity_receive');
    expect(sql).toContain('sap_processed_data spd');
    expect(sql).toContain('Quantity Receive');
    expect(sql).not.toContain('actual_vessel_qty_receive');
    expect(sql).toMatch(/WHEN[\s\S]*OP-\|MNL-\|MSEA-[\s\S]*THEN[\s\S]*sm\.received_qty[\s\S]*ELSE[\s\S]*qm\.quantity_receive/s);
  });
});
