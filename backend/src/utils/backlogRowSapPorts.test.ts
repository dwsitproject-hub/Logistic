import { describe, expect, it } from 'vitest';
import { unplannedContractBacklogRowSelectSql } from './shipmentUnplannedHybridSql';

describe('contract-backlog rows carry the SAP loading / discharge port', () => {
  for (const status of ['UNPLANNED', 'PREPLANNED', 'COMPLETED', 'CANCELLED'] as const) {
    it(`${status} rows project sap_loading_ports and sap_discharge_ports`, () => {
      const sql = unplannedContractBacklogRowSelectSql('0', status);
      expect(sql).toContain('AS sap_loading_ports');
      expect(sql).toContain('AS sap_discharge_ports');
    });
  }

  it('reads the PO latest SAP row, cleans the name once, and keeps KLIP ports empty (no shipment yet)', () => {
    const sql = unplannedContractBacklogRowSelectSql('0');
    expect(sql).toContain("spd.data->'raw'->>'Vessel Loading Port'");
    expect(sql).toContain("spd.data->'raw'->>'Vessel Discharge Port'");
    expect(sql).toContain('WHERE spd.contract_number = c.contract_id');
    // the latest-row lookup sits once inside a one-row subselect, not once per CASE arm of the name cleaner
    expect(sql.split("spd.data->'raw'->>'Vessel Loading Port'").length - 1).toBeLessThanOrEqual(2);
    expect(sql).toContain('NULL::text AS port_of_loading');
    expect(sql).toContain('NULL::text AS port_of_discharge');
  });
});
