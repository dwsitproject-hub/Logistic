import { describe, expect, it } from 'vitest';
import { JETTY_STATUS_HOSE_OFF, sqlJettyStatusShown } from './jettyStatusSql';
import { SHIPMENT_LIST_JPS_JOIN_SQL, SHIPMENT_LIST_JPS_SELECT_SQL } from './shipmentListStoJoinSql';
import { deriveShipmentStatus, pickDisplayedShipmentStatus } from './shipmentStatus';

describe('Jetty Status shown', () => {
  const sql = sqlJettyStatusShown('jps');

  it('is Completed (Hose Off) once JPS has logged the end of cargo operations and the vessel has not sailed', () => {
    expect(JETTY_STATUS_HOSE_OFF).toBe('Completed (Hose Off)');
    expect(sql).toContain('jps.schedule_cargo_ops_end_at IS NOT NULL');
    expect(sql).toContain("jps.jps_status IN ('Pending', 'Approved', 'Allocated')");
    expect(sql).toContain("THEN 'Completed (Hose Off)'");
  });

  it('leaves every other status as JPS reported it - Sailed and Rejected are not in the set', () => {
    expect(sql).toContain('ELSE jps.jps_status');
    expect(sql).not.toContain("'Sailed'");
    expect(sql).not.toContain("'Rejected'");
  });

  it('the list reads it through the one projection, and the join carries the column it needs', () => {
    expect(SHIPMENT_LIST_JPS_SELECT_SQL).toContain(sqlJettyStatusShown('jps'));
    expect(SHIPMENT_LIST_JPS_SELECT_SQL).toContain('jps.schedule_cargo_ops_end_at AS jetty_hose_off_at');
    expect(SHIPMENT_LIST_JPS_JOIN_SQL).toContain('j.schedule_cargo_ops_end_at');
  });

  it('is never stored: the stored status keeps what JPS reported', () => {
    expect(SHIPMENT_LIST_JPS_SELECT_SQL).not.toMatch(/UPDATE/i);
  });
});

describe('pickDisplayedShipmentStatus', () => {
  const atc = { ata_complete_discharge: '2026-10-05' };

  it('shows Completed when the ATA ladder says so although the stored status still says Planned (the JPS lane case)', () => {
    expect(pickDisplayedShipmentStatus('PLANNED', deriveShipmentStatus(atc))).toBe('COMPLETED');
  });

  it('never shows less than what was stored', () => {
    expect(pickDisplayedShipmentStatus('SAILED', deriveShipmentStatus({}))).toBe('SAILED');
    expect(pickDisplayedShipmentStatus('COMPLETED', deriveShipmentStatus({}))).toBe('COMPLETED');
  });

  it('never overrides Cancelled', () => {
    expect(pickDisplayedShipmentStatus('CANCELLED', deriveShipmentStatus(atc))).toBe('CANCELLED');
    expect(pickDisplayedShipmentStatus('canceled', deriveShipmentStatus(atc))).toBe('CANCELLED');
  });

  it('reads an empty or legacy stored status sensibly', () => {
    expect(pickDisplayedShipmentStatus(null, deriveShipmentStatus({}))).toBe('PLANNED');
    expect(pickDisplayedShipmentStatus('UNPLANNED', deriveShipmentStatus({}))).toBe('PLANNED');
    expect(pickDisplayedShipmentStatus('IN_TRANSIT', deriveShipmentStatus({}))).toBe('SAILED');
  });

  it('a closed contract completes the shipment, as the ladder already does', () => {
    expect(pickDisplayedShipmentStatus('PLANNED', deriveShipmentStatus({ contract_import_status: 'Close' }))).toBe('COMPLETED');
  });
});
