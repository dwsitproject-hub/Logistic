import { describe, expect, it } from 'vitest';
import {
  sqlContractInActiveLogisticsOpenOsExpr,
  sqlIncotermIsLandLogistics,
  sqlIncotermIsSeaLogistics,
} from './contractLogisticsOpenOsSql';

describe('contractLogisticsOpenOsSql', () => {
  it('scopes SEA vs LAND incoterms to the two logistics strips', () => {
    expect(sqlIncotermIsSeaLogistics('c.incoterm')).toContain("'FOB'");
    expect(sqlIncotermIsSeaLogistics('c.incoterm')).toContain("'CIF'");
    expect(sqlIncotermIsSeaLogistics('c.incoterm')).toContain("'CFR'");
    expect(sqlIncotermIsLandLogistics('c.incoterm')).toContain("'FRC'");
    expect(sqlIncotermIsLandLogistics('c.incoterm')).toContain("'LCO'");
  });

  it('Open OS membership is Shipments active pipeline or Trucking Unplanned/Planned/IP', () => {
    const sql = sqlContractInActiveLogisticsOpenOsExpr({
      contractUuidExpr: 'base.id',
      contractNumberExpr: 'base.contract_id',
      incotermExpr: 'base.incoterm',
    });
    expect(sql).toContain('shipments s');
    expect(sql).toContain('ata_discharge_complete');
    expect(sql).toContain('trucking_operations t');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('> 1000');
    expect(sql).toContain('tc.contract_id');
    expect(sql).not.toContain('spd.contract_number = c.contract_id');
    expect(sql).not.toContain('EXW');
  });
});
