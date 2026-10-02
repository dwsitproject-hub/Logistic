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
    expect(sql).toContain('CASE WHEN matched.port IS NOT NULL THEN matched.code_dhm ELSE via_alias.code_dhm END');
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
