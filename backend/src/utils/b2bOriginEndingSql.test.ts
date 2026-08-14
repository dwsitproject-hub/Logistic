import { describe, expect, it } from 'vitest';
import {
  sqlB2bEndingPlantCodeAgg,
  sqlB2bEndingPlantCodeExpr,
  sqlB2bEndingUnloadExpr,
  sqlB2bOriginEndingChildLateralJoin,
  sqlB2bOriginEndingUnloadSubquery,
} from './b2bOriginEndingSql';

describe('b2bOriginEndingSql', () => {
  it('looks up the latest child by Contract Reff PO and Truck Discharge Location', () => {
    const sql = sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' });
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('b2b_end');
    expect(sql).toContain("->>'Contract Reff PO Ini'");
    expect(sql).toContain("->>'Truck Discharge Location'");
    expect(sql).toContain('= TRIM(c.po_number)');
    expect(sql).toContain('ch.contract_date DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('prefers child plant and unload over origin fallbacks', () => {
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('b2b_end.plant_code');
    expect(sqlB2bEndingPlantCodeExpr('c.plant_code')).toContain('c.plant_code');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('b2b_end.unload_location');
    expect(sqlB2bEndingUnloadExpr('t.unloading_location')).toContain('t.unloading_location');
    expect(sqlB2bEndingPlantCodeAgg()).toContain('MAX(');
  });

  it('scalar unload subquery matches child by Contract Reff PO', () => {
    const sql = sqlB2bOriginEndingUnloadSubquery('c.po_number');
    expect(sql).toContain("->>'Truck Discharge Location'");
    expect(sql).toContain("->>'Contract Reff PO Ini'");
    expect(sql).toContain('= TRIM(c.po_number)');
  });
});
