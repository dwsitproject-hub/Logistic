import { describe, expect, it } from 'vitest';
import {
  B2B_ENDING_CHILD_SNAPSHOT_TABLE,
  buildB2bEndingChildSnapshotRefreshSql,
  sqlB2bEndingBuyerAgg,
  sqlB2bEndingBuyerExpr,
  sqlB2bEndingChildMapSelect,
  sqlB2bEndingDischargeDestExpr,
  sqlB2bEndingPlantCodeAgg,
  sqlB2bEndingPlantCodeExpr,
  sqlB2bEndingUnloadExpr,
  sqlB2bOriginEndingChildLateralJoin,
  sqlB2bOriginEndingUnloadSubquery,
  coalesceB2bOriginParentOrChildQty,
  sqlB2bChildGrStoAggSelect,
  sqlB2bChildGrStoStatusLookup,
  sqlCoalesceB2bOriginParentOrChildQty,
  sqlOverlayParentQtyOrQtyMoveSnapshot,
} from './b2bOriginEndingSql';

describe('b2bOriginEndingSql', () => {
  it('list overlay is a snapshot PK join, not a sap_processed_data scan', () => {
    const sql = sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' });
    expect(sql).not.toContain('LEFT JOIN LATERAL');
    expect(sql).not.toContain('DISTINCT ON');
    expect(sql).not.toContain('sap_processed_data');
    expect(sql).toContain(`LEFT JOIN ${B2B_ENDING_CHILD_SNAPSHOT_TABLE}`);
    expect(sql).toContain('b2b_end.origin_po = NULLIF(TRIM(c.po_number), \'\')');
  });

  it('child map is keyed by Contract Reff PO with latest child wins', () => {
    const sql = sqlB2bEndingChildMapSelect();
    expect(sql).toContain('DISTINCT ON (origin_po)');
    expect(sql).toContain('DISTINCT ON (spd.contract_number)');
    expect(sql).toContain('ORDER BY origin_po, contract_date DESC');
    expect(sql).toContain('discharge_destination');
    expect(sql).toContain('Discharge Destination');
  });

  it('snapshot refresh inserts the origin_po map', () => {
    const sql = buildB2bEndingChildSnapshotRefreshSql();
    expect(sql).toContain(`INSERT INTO ${B2B_ENDING_CHILD_SNAPSHOT_TABLE}`);
    expect(sql).toContain('DISTINCT ON (origin_po)');
    expect(sql).toContain('child_gr_sto_status');
    expect(sql).toContain('child_count');
    expect(sql).toContain('discharge_destination');
  });

  it('prefers child plant, unload, destinasi, and buyer over origin fallbacks', () => {
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('b2b_end.plant_code');
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('c.plant_code');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('b2b_end.unload_location');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('t.unloading_location');
    expect(sqlB2bEndingBuyerExpr('c.buyer')).toContain('b2b_end.buyer');
    expect(sqlB2bEndingBuyerExpr('c.buyer')).toContain('c.buyer');
    expect(sqlB2bEndingDischargeDestExpr("spd.data->'shipment'->>'discharge_destination'")).toContain(
      'b2b_end.discharge_destination',
    );
    expect(sqlB2bEndingPlantCodeAgg()).toContain('MAX(');
    expect(sqlB2bEndingBuyerAgg()).toContain('b2b_end.buyer');
  });

  it('scalar unload subquery reads the snapshot PK', () => {
    const sql = sqlB2bOriginEndingUnloadSubquery('c.po_number');
    expect(sql).toContain(B2B_ENDING_CHILD_SNAPSHOT_TABLE);
    expect(sql).toContain('m.origin_po = NULLIF(TRIM(c.po_number), \'\')');
    expect(sql).not.toContain('LEFT JOIN LATERAL');
    expect(sql).not.toContain('sap_processed_data');
  });
});

describe('B2B origin qty / GR STO overlay helpers', () => {
  // Example: parent 9231000077 qty NULL/0 + child 1001029278 qty 3000 → 3000; parent 200 → 200 not 3200.
  it('coalesceB2bOriginParentOrChildQty uses child when parent is NULL or 0, else replaces', () => {
    expect(coalesceB2bOriginParentOrChildQty(null, 3000)).toBe(3000);
    expect(coalesceB2bOriginParentOrChildQty(0, 3000)).toBe(3000);
    expect(coalesceB2bOriginParentOrChildQty(200, 3000)).toBe(200);
    expect(coalesceB2bOriginParentOrChildQty(200, 3000)).not.toBe(3200);
    expect(coalesceB2bOriginParentOrChildQty(0, null)).toBe(0);
    expect(coalesceB2bOriginParentOrChildQty(null, null)).toBeNull();
  });

  it('coalesceB2bOriginParentOrChildQty caps child SUM at origin contract qty', () => {
    expect(coalesceB2bOriginParentOrChildQty(0, 3000, { capAtParentContractQty: 1500 })).toBe(1500);
    expect(coalesceB2bOriginParentOrChildQty(null, 900, { capAtParentContractQty: 1500 })).toBe(900);
    expect(coalesceB2bOriginParentOrChildQty(200, 3000, { capAtParentContractQty: 1500 })).toBe(200);
  });

  it('sqlCoalesceB2bOriginParentOrChildQty is COALESCE(NULLIF(parent,0), child) not parent+child', () => {
    const sql = sqlCoalesceB2bOriginParentOrChildQty(
      'r.quantity_receive',
      'roll.sum_receive',
      'roll.origin_po IS NOT NULL',
    );
    expect(sql).toContain('COALESCE(NULLIF(r.quantity_receive, 0), roll.sum_receive)');
    expect(sql).not.toContain('r.quantity_receive +');
  });

  it('sqlCoalesceB2bOriginParentOrChildQty can LEAST-cap child SUM at parent contract qty', () => {
    const sql = sqlCoalesceB2bOriginParentOrChildQty(
      'r.quantity_delivery_vessel',
      'roll.sum_delivery_vessel',
      'roll.origin_po IS NOT NULL',
      { capAtParentContractQtyExpr: 'pc.quantity_ordered' },
    );
    expect(sql).toContain('LEAST(');
    expect(sql).toContain('pc.quantity_ordered');
    expect(sql).toContain('roll.sum_delivery_vessel');
  });

  it('child GR STO agg is any Open / all Close across children', () => {
    const sql = sqlB2bChildGrStoAggSelect();
    expect(sql).toContain('BOOL_OR');
    expect(sql).toContain("'OPEN'");
    expect(sql).toContain("'CLOSE'");
    expect(sql).toContain('child_gr_sto_status');
    expect(sql).toContain('COUNT(*)');
  });

  it('child GR STO lookup is a snapshot PK join without LIMIT 1', () => {
    const sql = sqlB2bChildGrStoStatusLookup('c.po_number');
    expect(sql).toContain(B2B_ENDING_CHILD_SNAPSHOT_TABLE);
    expect(sql).toContain('child_gr_sto_status');
    expect(sql).not.toContain('LIMIT 1');
  });

  it('sqlOverlayParentQtyOrQtyMoveSnapshot uses snapshot when parent qty is NULL or 0', () => {
    const sql = sqlOverlayParentQtyOrQtyMoveSnapshot(
      'parent.qty',
      'c.contract_id',
      'quantity_delivery_trucking',
    );
    expect(sql).toContain('contract_qty_move_snapshot');
    expect(sql).toContain('COALESCE(NULLIF(parent.qty, 0)');
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).not.toContain('parent.qty +');
  });
});
