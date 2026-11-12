import { describe, expect, it } from 'vitest';
import { SQL_RESOLVE_LATEST_SAP_ROW_FOR_SHIPMENT, keepOnlyPortNames } from './vesselLoadingPortsFromSap.service';

/**
 * Operation OP-1004030473-49138234 (2026-11-12): five shipments of a MANUAL STO (MNL-50527716-..., MT. MULIA KARSA 2) showed an ATC of 2026-09-15 that nobody typed. It was the ATC
 * of the same POs' finished voyage on STO 1006019867. Opening Edit Shipment ran the SAP port sync for every member, and the SAP row it resolved was not the shipment's own: the exact
 * branch also matched contracts.sto_number (the contract's STO), and the fallback row was used whole.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the SAP row a shipment takes its ports and dates from', () => {
  const sql = flat(SQL_RESOLVE_LATEST_SAP_ROW_FOR_SHIPMENT);

  it('is "own" only through the shipment\'s own STO references, not the contract\'s sto_number', () => {
    // rank 0, first arm: shipment_id or operation_id
    const rank = sql.slice(sql.indexOf('CASE'), sql.indexOf('END AS sto_match_rank'));
    const firstArm = rank.slice(0, rank.indexOf('WHEN NULLIF(TRIM(sh.shipment_id::text), \'\') IS NULL'));
    expect(firstArm).toContain("TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.shipment_id::text), '')");
    expect(firstArm).toContain("TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.operation_id::text), '')");
    expect(firstArm).not.toContain('sh.sto_number');
  });

  it('lets the contract\'s sto_number count only for a shipment with no STO reference of its own', () => {
    const rank = sql.slice(sql.indexOf('CASE'), sql.indexOf('END AS sto_match_rank'));
    const secondArm = rank.slice(rank.indexOf('WHEN NULLIF(TRIM(sh.shipment_id::text), \'\') IS NULL'));
    expect(secondArm).toContain("NULLIF(TRIM(sh.shipment_id::text), '') IS NULL AND NULLIF(TRIM(sh.operation_id::text), '') IS NULL");
    expect(secondArm).toContain("TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.sto_number::text), '')");
  });

  it('ranks the own STO first and still offers the contract\'s rows as a fallback', () => {
    expect(sql).toContain('ORDER BY sto_match_rank ASC, spd.created_at DESC NULLS LAST');
    expect(sql).toContain('OR (sh.contract_id IS NOT NULL AND spd.contract_number = sh.contract_id)');
    // the contract's sto_number in the WHERE is inside the "no reference of its own" guard too
    const where = sql.slice(sql.indexOf('WHERE ('));
    const matches = where.match(/sh\.sto_number/g) ?? [];
    expect(matches).toHaveLength(1);
    const guardStart = where.indexOf("NULLIF(TRIM(sh.shipment_id::text), '') IS NULL AND NULLIF(TRIM(sh.operation_id::text), '') IS NULL");
    expect(guardStart).toBeGreaterThan(-1);
    expect(where.indexOf('sh.sto_number')).toBeGreaterThan(guardStart);
  });
});

describe('a fallback row keeps only the names of its ports', () => {
  const planned = {
    port_name: 'PORT BONTANG',
    port_sequence: 999,
    is_discharge_port: true,
    ata_vessel_arrival: '2026-09-10',
    ata_vessel_berthed: '2026-09-11',
    ata_loading_start: '2026-09-12',
    ata_loading_completed: '2026-09-15',
    ata_vessel_sailed: '2026-09-15',
    eta_vessel_arrival: '2026-09-09',
    eta_vessel_complete_discharge: '2026-09-16',
    eta_vessel_arrive_at_discharge_port: '2026-09-14',
    loading_rate: 55.5,
    quantity_at_loading_port: 500000,
    quality_ffa: 4.8,
    quality_mi: 0.2,
    sap_quality_ffa: 4.8,
    sap_ata_loading_completed: '2026-09-15',
  };

  it('nulls every date, quantity and reading, and nothing else', () => {
    const out = keepOnlyPortNames(planned);
    expect(out.port_name).toBe('PORT BONTANG');
    expect(out.port_sequence).toBe(999);
    expect(out.is_discharge_port).toBe(true);
    for (const key of Object.keys(planned)) {
      if (['port_name', 'port_sequence', 'is_discharge_port'].includes(key)) continue;
      expect(out[key], key).toBeNull();
    }
    expect(Object.keys(out).sort()).toEqual(Object.keys(planned).sort());
  });

  it('does not change its input', () => {
    keepOnlyPortNames(planned);
    expect(planned.ata_loading_completed).toBe('2026-09-15');
  });

  it('leaves a row that has no dates as it is', () => {
    expect(keepOnlyPortNames({ port_name: 'MERAUKE', port_sequence: 1, is_discharge_port: false })).toEqual({
      port_name: 'MERAUKE',
      port_sequence: 1,
      is_discharge_port: false,
    });
  });
});
