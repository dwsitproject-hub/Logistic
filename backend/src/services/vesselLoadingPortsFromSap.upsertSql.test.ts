import { describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(),
}));

import { upsertVesselLoadingPortsFromSapData } from './vesselLoadingPortsFromSap.service';

/**
 * The SAP import UPDATEs an existing vessel_loading_ports row. Postgres analyses the whole SET list before it coerces each value to its column, so a bare
 * $2 used both in `port_name = $2` (varchar column) and in a comparison (deduced text) fails with "inconsistent types deduced for parameter $2 - text
 * versus character varying". That is what failed 256 STO rows of the 2026-10-13 06:00 import after the klip_edited_fields CASE was added. The statement
 * can only be proven by a database; this pins the one shape that broke, and PREPARE on a real Postgres proved the cast fixes it.
 */
describe('SAP import UPDATE of an existing vessel_loading_ports row', () => {
  function fakeClient() {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[] = []) {
        statements.push({ sql, params });
        // the SELECT that looks for an existing port row answers with one, so the UPDATE path runs
        if (/^\s*SELECT \*\s+FROM vessel_loading_ports/i.test(sql)) return { rows: [{ id: 'port-1', klip_edited_fields: ['port_name'] }] };
        return { rows: [], rowCount: 1 };
      },
    };
    return { client, statements };
  }

  const parsed = { shipment: { vessel_loading_port_1: 'POM KENDAWANGAN' }, raw: {} };

  it('takes the UPDATE path and sends the statement', async () => {
    const { client, statements } = fakeClient();
    await upsertVesselLoadingPortsFromSapData(client as never, 'shipment-1', parsed);
    const update = statements.find((s) => /UPDATE vessel_loading_ports SET/.test(s.sql));
    expect(update).toBeTruthy();
    expect(update!.params[0]).toBe('port-1');
  });

  it('never uses a bare $2 in the comparison that shares $2 with the port_name assignment', async () => {
    const { client, statements } = fakeClient();
    await upsertVesselLoadingPortsFromSapData(client as never, 'shipment-1', parsed);
    const sql = statements.find((s) => /UPDATE vessel_loading_ports SET/.test(s.sql))!.sql;
    expect(sql).toMatch(/port_name = \$2,/);
    expect(sql).toMatch(/port_name IS DISTINCT FROM \$2::varchar/);
    expect(sql).not.toMatch(/IS DISTINCT FROM \$2(?!::)/);
  });

  it('still clears the user marker only when SAP writes a DIFFERENT name', async () => {
    const { client, statements } = fakeClient();
    await upsertVesselLoadingPortsFromSapData(client as never, 'shipment-1', parsed);
    const sql = statements.find((s) => /UPDATE vessel_loading_ports SET/.test(s.sql))!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain("array_remove(COALESCE(klip_edited_fields, '{}'), 'port_name')");
    expect(sql).toMatch(/ELSE klip_edited_fields END/);
  });
});
