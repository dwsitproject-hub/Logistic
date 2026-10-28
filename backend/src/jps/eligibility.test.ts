import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));

import { query } from '../database/connection';
import { findEligibleStos } from './eligibility';

async function sqlOf(): Promise<string> {
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
  await findEligibleStos(['PORT BONTANG'], 10);
  return String(vi.mocked(query).mock.calls[0]![0]);
}

async function callOf(): Promise<[string, unknown[]]> {
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
  await findEligibleStos(['PORT BONTANG'], 10);
  const call = vi.mocked(query).mock.calls[0]!;
  return [String(call[0]), call[1] as unknown[]];
}

describe('findEligibleStos: the port code comes from the Master Port the discharge port text resolves to', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  // SAP writes the destination PLANT in Vessel Discharge Port on 46% of rows (EUP EDIBLE OIL BONTANG ...), and Master Port holds only real ports. Since migration 237
  // each Master Port carries the SAP texts that stand for it (VESSEL PORT (SAP)) and the shipment carries the id of the port its text resolves to.
  it('reads the Master Port by the id stored on the shipment, else on its active discharge leg, and no longer by name or alias', async () => {
    const sql = await sqlOf();
    const port = sql.slice(sql.indexOf('port AS ('), sql.indexOf('vessel AS ('));
    expect(port).toContain('s.discharge_master_port_id');
    expect(port).toContain('v.master_port_id');
    expect(port).toContain('LEFT JOIN master_loading_ports mp ON mp.id = dp.id');
    // SQL comments name the old table; only the statement itself matters here
    const statement = sql.replace(/--[^\n]*/g, '');
    expect(statement).not.toContain('discharge_port_aliases');
    expect(statement).not.toContain('via_alias');
  });

  it('a Master Port deleted in DHM gives no code and says so (port_deleted)', async () => {
    const sql = await sqlOf();
    expect(sql).toContain('CASE WHEN COALESCE(mp.dhm_is_deleted, FALSE) THEN NULL ELSE mp.code_dhm END');
    expect(sql).toContain('COALESCE(mp.dhm_is_deleted, FALSE)');
  });

  it('keeps Master Port free of plant names: the lookup reads Master Port, never writes it', async () => {
    const sql = await sqlOf();
    expect(sql).not.toMatch(/INSERT INTO master_loading_ports/i);
  });
});

// A shipment planned by hand keeps its discharge port as a vessel_loading_ports row (is_discharge_port) and leaves
// shipments.port_of_discharge NULL, so the port was never found and the STO was held on every sweep.
describe('findEligibleStos: the discharge port of a shipment', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('reads the active discharge leg when the shipment has no Master Port of its own', async () => {
    const sql = await sqlOf();
    expect(sql).toContain('FROM vessel_loading_ports v');
    expect(sql).toContain('COALESCE(v.is_discharge_port, FALSE) IS TRUE');
    expect(sql).toContain('COALESCE(v.is_cancelled, FALSE) IS NOT TRUE');
  });

  it('never matches on the bare text column: only the stored Master Port ids count', async () => {
    const sql = await sqlOf();
    const port = sql.slice(sql.indexOf('port AS ('), sql.indexOf('vessel AS ('));
    const bare = port.replace(/--[^\n]*/g, '');
    expect(bare).not.toContain('s.port_of_discharge');
    expect(bare).not.toContain('dp.name');
  });
});

// Only the discharge port the integration is switched on for is submitted: PORT BONTANG for now (Ryan, 2026-10-14).
describe('findEligibleStos: only the Master Ports switched on for JPS', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('the ports are ONE bound array, FIRST, and the shipment must discharge at one of them (resolved to Master Port ids); there is no Region/Site condition', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    await findEligibleStos(['PORT BONTANG', 'PORT DUMAI'], 10);
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['PORT BONTANG', 'PORT DUMAI'], 10, false, 0]);
    expect(sql).toContain('IN (SELECT klip_resolve_master_port_id(p) FROM unnest($1::text[]) AS p)');
    // JPS knows a port and nothing else: the contract's Region/Site decides nothing
    expect(sql).not.toContain('discharge_destination');
  });

  it('with no port switched on the list is empty and nothing is eligible (nothing is built into the code)', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    await findEligibleStos([], 10);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([[], 10, false, 0]);
  });

  it('the port of an eligible shipment is the Master Port its text resolves to: its own id, else its active discharge leg', async () => {
    const sql = await sqlOf();
    const eligible = sql.slice(sql.indexOf('WITH eligible AS ('), sql.indexOf('port AS ('));
    expect(eligible).toContain('s.discharge_master_port_id');
    expect(eligible).toContain('v.master_port_id');
    expect(eligible).toContain("COALESCE(v.is_discharge_port, FALSE) IS TRUE");
  });

  it('amending by STO key numbers nothing after the three it binds: the ports stay $1', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    await findEligibleStos(['PORT BONTANG'], 10, { stoKeys: ['1006019385'] });
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['PORT BONTANG'], 10, ['1006019385']]);
    expect(sql).toContain('unnest($1::text[])');
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
    expect(port).toContain('CASE WHEN COALESCE(mp.dhm_is_deleted, FALSE) THEN NULL ELSE mp.code_dhm END');
    expect(port).toContain('COALESCE(mp.dhm_is_deleted, FALSE)');
    // a live Master Port is already preferred when the id is resolved (klip_resolve_master_port_id); a shipment with no port sorts last
    expect(port).toContain('CASE WHEN mp.id IS NULL THEN 1 ELSE 0 END');
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

describe('findEligibleStos: the STO number of each cargo line (JPS 5.6 sto_no)', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('names the STO on the lines that come from contract_stos, and sends nothing for the lines that have none', async () => {
    const sql = (await sqlOf()).replace(/\s+/g, ' ');
    // the contract_stos arm: the line's own STO number
    expect(sql).toContain("MAX(NULLIF(TRIM(cs.sto_number), '')) AS sto_no");
    // the contract-quantity fallback arm (manual shipment, or a transaction without an STO): no STO, and no other id in its place
    expect(sql).toContain('NULL::text AS sto_no');
    expect(sql).toContain("'sto_no', x.sto_no");
  });

  it('carries sto_no through to the cargo source, empty as null', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        {
          sto_key: '1006020269',
          cargo: [
            { contract_no: 'C1', sto_no: ' 1006020269 ', sto_quantity_kg: 1000 },
            { contract_no: 'C2', sto_no: null, sto_quantity_kg: 2000 },
            { contract_no: 'C3', sto_no: '  ', sto_quantity_kg: 3000 },
          ],
        },
      ],
      rowCount: 1,
    } as any);
    const [sto] = await findEligibleStos(['PORT BONTANG'], 10);
    expect(sto!.cargo.map((l) => l.sto_no)).toEqual(['1006020269', null, null]);
  });
});
