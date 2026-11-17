import { describe, expect, it } from 'vitest';
import { sqlJpsEstimateJsonExpr } from './scheduleAtaSql';

describe('sqlJpsEstimateJsonExpr: the JPS estimates the Edit / View Shipment modal shows beside KLIP\'s own', () => {
  const sql = sqlJpsEstimateJsonExpr('jps');

  it('maps eta, etb and etc to the three discharge estimation fields, with the same names the modal reads', () => {
    expect(sql).toContain("'eta_vessel_arrive_at_discharge_port', ((jps.schedule_eta AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(sql).toContain("'eta_vessel_berthed_at_discharge_port', ((jps.schedule_etb AT TIME ZONE 'Asia/Jakarta')::date)::text");
    expect(sql).toContain("'eta_vessel_complete_discharge', ((jps.schedule_etc AT TIME ZONE 'Asia/Jakarta')::date)::text");
  });

  it('dates in WIB: a UTC instant at 17:00 or later is already the next day in Jakarta', () => {
    expect(sql.match(/AT TIME ZONE 'Asia\/Jakarta'/g)).toHaveLength(3);
  });

  it('has no ETS (start discharging): JPS has no such estimate', () => {
    expect(sql).not.toContain('start_discharging');
  });

  it('uses the alias it is given', () => {
    expect(sqlJpsEstimateJsonExpr('j2')).toContain('j2.schedule_eta');
    expect(sqlJpsEstimateJsonExpr('j2')).not.toContain('jps.');
  });
});
