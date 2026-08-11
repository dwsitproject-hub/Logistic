import { describe, expect, it } from 'vitest';
import {
  buildVesselIdleListQuery,
  buildVesselWillFreeListQuery,
  VESSEL_WILL_FREE_HORIZON_DAYS,
} from '../services/vesselIdle.service';

describe('vesselIdle.service', () => {
  it('buildVesselIdleListQuery identifies busy vessels with shipment-scoped STO, planned ETA, or ongoing shipment', () => {
    const sql = buildVesselIdleListQuery();
    expect(sql).toContain('busy_canonical_names');
    expect(sql).toContain('idle_vessels');
    expect(sql).toContain('most_loading');
    expect(sql).toContain('most_discharge');
    expect(sql).toContain('master_vessels');
    expect(sql).toContain('s.shipment_id');
    expect(sql).not.toContain('latest_spd');
    expect(sql).not.toContain('effective_sto');
    const busySection = sql.slice(
      sql.indexOf('busy_canonical_names'),
      sql.indexOf('idle_vessels'),
    );
    expect(busySection.indexOf('s.shipment_id')).toBeLessThan(
      busySection.indexOf('c.sto_number'),
    );
  });

  it('buildVesselIdleListQuery avoids NOT IN with NULL busy names (canonical merge safe)', () => {
    const sql = buildVesselIdleListQuery();
    expect(sql).not.toContain('NOT IN (SELECT normalized_vessel_name FROM busy_canonical_names');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toMatch(/busy_canonical_names[\s\S]*normalized_vessel_name IS NOT NULL/);
    expect(sql).toMatch(/idle_vessels[\s\S]*normalized_vessel_name IS NOT NULL/);
  });

  it('buildVesselWillFreeListQuery filters on-going vessels by ETC at discharge within horizon', () => {
    const sql = buildVesselWillFreeListQuery();
    expect(sql).toContain('will_free_vessels');
    expect(sql).toContain('eta_vessel_complete_discharge');
    expect(sql).toContain('eta_discharge_complete');
    expect(sql).toContain(`CURRENT_DATE + ${VESSEL_WILL_FREE_HORIZON_DAYS}`);
  });
});
