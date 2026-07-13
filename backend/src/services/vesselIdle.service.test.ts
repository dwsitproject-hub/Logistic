import { describe, expect, it } from 'vitest';
import { buildVesselIdleListQuery } from '../services/vesselIdle.service';

describe('vesselIdle.service', () => {
  it('buildVesselIdleListQuery identifies busy vessels with SAP STO, planned ETA, or ongoing shipment', () => {
    const sql = buildVesselIdleListQuery();
    expect(sql).toContain('busy_vessel_ids');
    expect(sql).toContain('idle_vessels');
    expect(sql).toContain('most_loading');
    expect(sql).toContain('most_discharge');
    expect(sql).toContain('master_vessels');
    expect(sql).toContain('spd.effective_sto');
    expect(sql).toMatch(/busy_vessel_ids[\s\S]*spd\.effective_sto/);
  });
});
