import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));

import { query } from '../database/connection';
import { findEligibleStos } from './eligibility';

async function sqlOf(): Promise<string> {
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
  await findEligibleStos('BONTANG', 10);
  return String(vi.mocked(query).mock.calls[0]![0]);
}

describe('findEligibleStos: which port a plant-named discharge port resolves to', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  // SAP writes the destination PLANT in Vessel Discharge Port on 46% of rows (EUP EDIBLE OIL BONTANG ...),
  // and Master Port holds only real ports. Those STOs were all held until the alias lookup existed.
  it('falls back to discharge_port_aliases only when no Master Port carries the name', async () => {
    const sql = await sqlOf();
    expect(sql).toContain('FROM discharge_port_aliases dpa');
    expect(sql).toContain('WHERE matched.port IS NULL');
    // a Master Port that carries the name wins; the alias route is the ELSE branch of the same CASE
    expect(sql).toContain('CASE WHEN matched.port IS NOT NULL');
    expect(sql).toContain('THEN CASE WHEN COALESCE(matched.dhm_is_deleted, FALSE) THEN NULL ELSE matched.code_dhm END');
    expect(sql).toContain('ELSE CASE WHEN COALESCE(via_alias.dhm_is_deleted, FALSE) THEN NULL ELSE via_alias.code_dhm END');
  });

  it('takes the port named "PORT <site>" and nothing looser', async () => {
    const sql = await sqlOf();
    expect(sql).toContain("= 'PORT ' || regexp_replace(upper(btrim(st.site_name))");
    // "the Site's only port" picked PORT KUMAI for BEKASI, so there is no such fallback
    expect(sql).not.toMatch(/COUNT\(\*\) OVER/);
  });

  it('keeps Master Port free of plant names: the alias lookup reads Master Port, never writes it', async () => {
    const sql = await sqlOf();
    expect(sql).not.toMatch(/INSERT INTO master_loading_ports/i);
  });
});

// A shipment planned by hand keeps its discharge port as a vessel_loading_ports row (is_discharge_port) and leaves
// shipments.port_of_discharge NULL, so the port was never found and the STO was held on every sweep.
describe('findEligibleStos: the discharge port name', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('reads the discharge port row when the shipment column is empty', async () => {
    const sql = await sqlOf();
    expect(sql).toContain('FROM vessel_loading_ports v');
    expect(sql).toContain('COALESCE(v.is_discharge_port, FALSE) IS TRUE');
    expect(sql).toContain("NULLIF(BTRIM(s.port_of_discharge), ''),");
  });

  it('matches Master Port and the aliases on that name, never on the bare column', async () => {
    const sql = await sqlOf();
    const port = sql.slice(sql.indexOf('port AS ('), sql.indexOf('vessel AS ('));
    // SQL comments mention the column by name; only the statement itself matters here
    const bare = port.replace(/--[^\n]*/g, '').replace(/NULLIF\(BTRIM\(s\.port_of_discharge\), ''\),/, '');
    expect(bare).not.toContain('s.port_of_discharge');
    expect(port).toContain('dp.name');
  });
});

// BG. AS WARRIOR 2 was held for "no DHM code on Master Vessel" while the Shipments page listed it under VSL-0036: the JPS
// lookup stopped at the code alias, the page also matches the vessel code and the normalized name.
describe('findEligibleStos: which Master Vessel an STO takes its DataHub code from', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('resolves the vessel the way the Shipments page does, by link, alias, code and normalized name', async () => {
    const sql = await sqlOf();
    const vessel = sql.slice(sql.indexOf('vessel AS ('), sql.indexOf('terms AS ('));
    expect(vessel).toContain('LEFT JOIN master_vessels mv ON mv.id = COALESCE(');
    expect(vessel).toContain('master_vessel_code_aliases');
    expect(vessel).toContain('normalize_vessel_name');
    expect(vessel).toContain('s.master_vessel_id');
  });
});

// A master deleted in DHM is flagged, not removed, and JPS no longer knows its hub code: sending it would only be refused.
// These are string checks on the SQL (it cannot run without a database), so the query still needs one real run on SIT.
describe('findEligibleStos: masters deleted in DHM give no code', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('port: a deleted Master Port resolves to no code, a live one is preferred, and the reason is exposed', async () => {
    const sql = await sqlOf();
    const port = sql.slice(sql.indexOf('port AS ('), sql.indexOf('vessel AS ('));
    expect(port).toContain('COALESCE(matched.dhm_is_deleted, FALSE) THEN NULL ELSE matched.code_dhm');
    expect(port).toContain('COALESCE(via_alias.dhm_is_deleted, FALSE) THEN NULL ELSE via_alias.code_dhm');
    expect(port).toContain('COALESCE(mp.dhm_is_deleted, FALSE),');
    expect(port).toContain('ORDER BY COALESCE(sp.dhm_is_deleted, FALSE)');
    expect(port).toContain('AS port_deleted');
  });

  it('vessel: a deleted Master Vessel gives no code and sets vessel_deleted', async () => {
    const sql = await sqlOf();
    const vessel = sql.slice(sql.indexOf('vessel AS ('), sql.indexOf('terms AS ('));
    expect(vessel).toContain('mv.dhm_code IS NOT NULL AND COALESCE(mv.dhm_is_deleted, FALSE) IS NOT TRUE');
    expect(vessel).toContain('AS vessel_deleted');
  });

  it('product: a deleted Master Product gives no code, a live one is preferred, and the line says why', async () => {
    const sql = await sqlOf();
    const cargo = sql.slice(sql.indexOf('cargo AS ('), sql.indexOf('docs AS ('));
    expect(cargo).toContain('ORDER BY COALESCE(p.dhm_is_deleted, FALSE), p.code_dhm');
    expect(cargo).toContain("'product_hub_code', CASE WHEN COALESCE(pc.dhm_is_deleted, FALSE) THEN NULL ELSE pc.code_dhm END");
    expect(cargo).toContain("'product_deleted'");
  });

  it('the final SELECT hands the flags to the mapper', async () => {
    const sql = await sqlOf();
    expect(sql).toContain('v.vessel_deleted');
    expect(sql).toContain('p.port_deleted');
  });
});
