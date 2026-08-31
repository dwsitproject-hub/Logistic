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

  it('Open OS membership is Shipments GR-Open pipeline or Trucking Unplanned/Planned/IP', () => {
    const sql = sqlContractInActiveLogisticsOpenOsExpr({
      contractUuidExpr: 'base.id',
      contractNumberExpr: 'base.contract_id',
      incotermExpr: 'base.incoterm',
    });
    expect(sql).toContain('shipments s');
    expect(sql).not.toContain('ata_discharge_complete');
    expect(sql).toContain('trucking_operations t');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('> 1000');
    expect(sql).toContain('tc.contract_id');
    expect(sql).toContain('UNPLANNED');
    expect(sql).toContain('PLANNED');
    expect(sql).toContain('IN_PROGRESS');
    expect(sql).toContain('LAND');
    expect(sql).toContain('MIX');
    expect(sql).not.toContain('spd.contract_number = c.contract_id');
    expect(sql).not.toContain('EXW');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('cs_self.contract_id = base.id');
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).toContain('b2b_ending_child_snapshot');
    expect(sql).toContain('child_gr_sto_status');
  });

  it('SEA backlog matches Unplanned/Preplanned: no shipment and no registered ETA', () => {
    const sql = sqlContractInActiveLogisticsOpenOsExpr({
      contractUuidExpr: 'base.id',
      contractNumberExpr: 'base.contract_id',
      incotermExpr: 'base.incoterm',
    });
    expect(sql).toContain('s_eta');
    expect(sql).toContain('eta_vessel_arrival');
    expect(sql).toContain('c_sea');
  });
});
