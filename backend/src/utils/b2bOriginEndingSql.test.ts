import { describe, expect, it } from 'vitest';
import {
  B2B_ENDING_CHILD_SNAPSHOT_TABLE,
  buildB2bEndingChildSnapshotRefreshSql,
  sqlB2bEndingBuyerAgg,
  sqlB2bEndingBuyerExpr,
  sqlB2bEndingChildMapSelect,
  sqlB2bEndingPlantCodeAgg,
  sqlB2bEndingPlantCodeExpr,
  sqlB2bEndingUnloadExpr,
  sqlB2bOriginEndingChildLateralJoin,
  sqlB2bOriginEndingUnloadSubquery,
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
  });

  it('snapshot refresh inserts the origin_po map', () => {
    const sql = buildB2bEndingChildSnapshotRefreshSql();
    expect(sql).toContain(`INSERT INTO ${B2B_ENDING_CHILD_SNAPSHOT_TABLE}`);
    expect(sql).toContain('DISTINCT ON (origin_po)');
  });

  it('prefers child plant, unload, and buyer over origin fallbacks', () => {
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('b2b_end.plant_code');
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('c.plant_code');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('b2b_end.unload_location');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('t.unloading_location');
    expect(sqlB2bEndingBuyerExpr('c.buyer')).toContain('b2b_end.buyer');
    expect(sqlB2bEndingBuyerExpr('c.buyer')).toContain('c.buyer');
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
