import { describe, expect, it } from 'vitest';
import {
  buildQtyMoveCte,
  buildQtyMoveFromSnapshotCte,
  buildContractQtyMoveSnapshotRefreshSql,
  sqlContractGlobalOutstandingExpr,
} from './contractGlobalOutstandingSql';

describe('contractGlobalOutstandingSql', () => {
  it('buildQtyMoveCte supports contract_scope join', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('contract_scope');
    expect(sql).toContain('latest_per_sto');
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).toContain('quantity_delivery_vessel');
    expect(sql).toContain('deduped');
  });

  it('buildQtyMoveCte supports in_subquery filter', () => {
    const sql = buildQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_number FROM contract_candidates',
    });
    expect(sql).toContain('contract_candidates');
  });

  it('sqlContractGlobalOutstandingExpr uses qty_move receive/delivery per incoterm (Contracts list rules)', () => {
    const sql = sqlContractGlobalOutstandingExpr({
      contractQtyExpr: 'pl.contract_qty',
      incotermExpr: 'pl.incoterm',
      contractNumberExpr: 'pl.contract_number',
    });
    expect(sql).toContain('qty_move');
    expect(sql).toContain('quantity_receive');
    expect(sql).toContain('quantity_delivery');
    expect(sql).toContain("'FRC', 'CIF', 'CFR'");
    expect(sql).toContain("'LCO', 'FOB'");
    expect(sql).toContain('GREATEST');
  });

  it('qty_move quantity_delivery ignores zero vessel so trucking qty is not masked', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('NULLIF');
    expect(sql).toContain('quantity_delivery_vessel');
    expect(sql).toContain('quantity_delivery_trucking');
  });

  it('buildQtyMoveCte overlays LAND FRC/LCO qty from trucking WB daily actuals', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('trucking_wb_overlay');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('qty_move_sap');
    expect(sql).toContain('wb_delivery_qty_kg');
    expect(sql).toContain('wb_receive_qty_kg');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain("IN ('FRC', 'LCO')");
    expect(sql).toContain("LIKE 'LAND%'");
    // Close → SAP (no WB overlay), same as Trucking list
    expect(sql).toMatch(/trucking_wb_overlay[\s\S]*AND NOT \(/);
  });

  it('buildQtyMoveCte overlays SEA FOB/CIF qty from Open KLIP shipment actuals', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('shipment_klip_overlay');
    expect(sql).toContain('klip_delivery_kg');
    expect(sql).toContain('klip_receive_kg');
    expect(sql).toContain("IN ('FOB', 'CIF')");
    expect(sql).toContain('quantity_delivered_klip');
    expect(sql).toContain('actual_vessel_qty_receive');
    expect(sql).toContain("COALESCE(s.status, '') <> 'CANCELLED'");
    expect(sql).toContain('sk.klip_delivery_kg');
    expect(sql).toContain('sk.klip_receive_kg');
  });

  it('buildQtyMoveCte shipment overlay remains in in_subquery (snapshot refresh path)', () => {
    const sql = buildQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_id FROM contracts',
    });
    expect(sql).toContain('shipment_klip_overlay');
    expect(sql).toContain('SELECT contract_id FROM contracts');
  });

  it('buildQtyMoveFromSnapshotCte reads contract_qty_move_snapshot scoped to list', () => {
    const sql = buildQtyMoveFromSnapshotCte('contract_scope');
    expect(sql).toContain('contract_qty_move_snapshot');
    expect(sql).toContain('INNER JOIN contract_scope');
    expect(sql).toContain('quantity_delivery');
  });

  it('buildContractQtyMoveSnapshotRefreshSql reuses live qty_move builder', () => {
    const sql = buildContractQtyMoveSnapshotRefreshSql();
    expect(sql).toContain('INSERT INTO contract_qty_move_snapshot');
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('trucking_wb_overlay');
    expect(sql).toContain('shipment_klip_overlay');
  });
});
