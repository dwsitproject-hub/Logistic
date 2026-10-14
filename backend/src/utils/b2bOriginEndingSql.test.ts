import { describe, expect, it } from 'vitest';
import {
  B2B_ENDING_CHILD_SNAPSHOT_TABLE,
  buildB2bEndingChildSnapshotRefreshSql,
  sqlB2bEndingBuyerAgg,
  sqlB2bEndingBuyerExpr,
  sqlB2bChildDischargePortLookup,
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
    expect(sql).toContain('b2b_ending_child_snapshot_meta');
    expect(sql).toContain('is_stale IS TRUE');
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
    expect(sql).not.toContain('b2b_ending_child_snapshot_meta');
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

describe('B2B ending child discharge port (migration 235)', () => {
  const map = sqlB2bEndingChildMapSelect().replace(/\s+/g, ' ');
  const refresh = buildB2bEndingChildSnapshotRefreshSql().replace(/\s+/g, ' ');

  it('the snapshot stores the child\'s SAP Vessel Discharge Port next to the other overlay columns', () => {
    expect(refresh).toContain('discharge_destination, discharge_port, child_gr_sto_status');
    expect(refresh).toContain('latest.discharge_port');
    expect(map).toContain("ch_spd.data->'raw'->>'Vessel Discharge Port'");
  });

  it('it is the NEWEST child that has a human port name, so a port missing on the latest child does not hide the previous one', () => {
    expect(map).toContain('ARRAY_AGG(s1.child_port) FILTER (WHERE s1.child_port IS NOT NULL)');
    expect(map).toContain('PARTITION BY s1.origin_po ORDER BY s1.contract_date DESC NULLS LAST, s1.created_at DESC NULLS LAST');
    expect(map).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING');
  });

  it('blanks and numeric SAP codes are no port, and the SAP text is read once before it is cleaned', () => {
    expect(map).toContain("IN ('', '0', '0.00')");
    expect(map).toMatch(/s0\.child_port_text/);
    expect(map.match(/ch_spd\.data->'raw'->>'Vessel Discharge Port'/g)?.length).toBe(1);
  });

  it('the other overlay columns still come from the latest child as a whole', () => {
    expect(map).toContain('SELECT DISTINCT ON (origin_po)');
    expect(map).toContain('ORDER BY origin_po, contract_date DESC NULLS LAST, created_at DESC NULLS LAST');
  });
});

describe('sqlB2bChildDischargePortLookup', () => {
  it('is a PK lookup on the snapshot by the origin PO, ignored while the snapshot is being rebuilt', () => {
    const sql = sqlB2bChildDischargePortLookup('c.po_number').replace(/\s+/g, ' ');
    expect(sql).toContain('FROM b2b_ending_child_snapshot m');
    expect(sql).toContain("m.origin_po = NULLIF(TRIM(c.po_number), '')");
    expect(sql).toContain("NULLIF(TRIM(m.discharge_port), '')");
    expect(sql).toContain('is_stale IS TRUE');
    expect(sql).not.toContain('sap_processed_data');
  });
});
