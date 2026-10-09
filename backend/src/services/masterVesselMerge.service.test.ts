import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { applyMasterVesselMerge, mergeBlockers, planMasterVesselMerge, type MasterRow } from './masterVesselMerge.service';

const row = (over: Partial<MasterRow> = {}): MasterRow => ({
  id: 'a', vessel_name: 'TB. TOLLANDAK II', vessel_code: 'MLANDAK2', vessel_role: 'TB', vessel_type: 'TUG BOAT',
  code_status: 'OFFICIAL', dhm_id: null, dhm_code: null, ...over,
});
const dhmRow = (over: Partial<MasterRow> = {}): MasterRow =>
  row({ id: 'b', vessel_name: 'TB. TOL LANDAK II', vessel_code: 'VSL-2455', vessel_role: null, vessel_type: null, dhm_id: 'dhm-1', dhm_code: 'VSL-2455', ...over });

describe('mergeBlockers', () => {
  it('lets a copy that is not linked to DHM go into the row DHM already knows', () => {
    expect(mergeBlockers(row(), dhmRow())).toEqual([]);
  });

  it('never deletes a row that is linked to DHM, and says to merge the other way', () => {
    const blockers = mergeBlockers(dhmRow(), row());
    expect(blockers.join(' ')).toMatch(/terhubung ke DHM/);
  });

  it('refuses two different roles, a tug into a barge, a missing row and a vessel into itself', () => {
    expect(mergeBlockers(row({ vessel_role: 'TB' }), row({ id: 'c', vessel_role: 'BG', vessel_type: 'BARGE' })).join(' ')).toMatch(/peran berbeda/);
    expect(mergeBlockers(row({ vessel_role: null, vessel_type: 'TUG BOAT' }), row({ id: 'c', vessel_role: null, vessel_type: 'BARGE' })).join(' ')).toMatch(/tugboat dan satu tongkang/);
    expect(mergeBlockers(null, row()).join(' ')).toMatch(/from/);
    expect(mergeBlockers(row(), null).join(' ')).toMatch(/into/);
    expect(mergeBlockers(row(), row()).join(' ')).toMatch(/sama/);
  });

  it('allows an untyped row into a typed one (nothing says they differ)', () => {
    expect(mergeBlockers(row({ vessel_role: null, vessel_type: null }), row({ id: 'c', vessel_type: 'BARGE', vessel_role: 'BG' }))).toEqual([]);
  });
});

function fakeClient(rows: MasterRow[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM master_vessels\s+WHERE id = \$1::uuid/i.test(sql)) return { rows: rows.filter((r) => r.id === params[0]) };
    if (/upper\(trim\(vessel_name\)\)/i.test(sql)) return { rows: rows.filter((r) => r.vessel_name.toUpperCase() === String(params[0]).toUpperCase()) };
    if (/SELECT count\(\*\)/i.test(sql)) return { rows: [{ n: 2 }] };
    return { rows: [], rowCount: 1 };
  };
  return { client: { query } as unknown as PoolClient, calls };
}

describe('planMasterVesselMerge / applyMasterVesselMerge', () => {
  it('finds both rows by exact name and counts what would move', async () => {
    const { client } = fakeClient([row(), dhmRow()]);
    const plan = await planMasterVesselMerge(client, 'tb. tollandak ii', 'TB. TOL LANDAK II');
    expect(plan.blockers).toEqual([]);
    expect(plan.from?.id).toBe('a');
    expect(plan.into?.id).toBe('b');
    expect(plan.counts).toEqual({ aliases: 2, shipments: 2, pairs: 2 });
  });

  it('refuses a name that matches several rows', async () => {
    const { client } = fakeClient([row(), row({ id: 'z' })]);
    await expect(planMasterVesselMerge(client, 'TB. TOLLANDAK II', 'b')).rejects.toThrow(/cocok dengan 2 baris/);
  });

  it('moves codes as non-primary aliases, shipments and pairs, fills only empty fields, then deletes the copy', async () => {
    const { client, calls } = fakeClient([row(), dhmRow()]);
    const plan = await planMasterVesselMerge(client, 'TB. TOLLANDAK II', 'TB. TOL LANDAK II');
    calls.length = 0;
    await applyMasterVesselMerge(client, plan, { renameSurvivorTo: 'TB. TOL LANDAK II' });
    const sqls = calls.map((c) => c.sql.replace(/\s+/g, ' '));
    const at = (re: RegExp) => sqls.findIndex((s) => re.test(s));

    expect(sqls[at(/UPDATE master_vessels t SET/)]).toMatch(/COALESCE\(t\.vessel_role, f\.vessel_role\)/);
    expect(sqls[at(/UPDATE master_vessel_code_aliases/)]).toMatch(/is_primary = false/);
    expect(at(/UPDATE shipments SET master_vessel_id/)).toBeGreaterThan(-1);
    // pairs the survivor already has are dropped BEFORE the rest are re-pointed, or the unique (tb, bg) key would reject the move
    expect(at(/DELETE FROM vessel_pairs/)).toBeLessThan(at(/UPDATE vessel_pairs SET tb_master_vessel_id/));
    // everything that pointed at the copy has moved before it is deleted
    expect(at(/DELETE FROM master_vessels/)).toBeGreaterThan(at(/UPDATE vessel_pairs SET bg_master_vessel_id/));
    expect(calls[at(/DELETE FROM master_vessels/)].params).toEqual(['a']);
    expect(calls.at(-1)!.params).toEqual(['b', 'TB. TOL LANDAK II']);
  });

  it('throws, and writes nothing, when the plan has blockers', async () => {
    const { client, calls } = fakeClient([dhmRow({ id: 'a' }), row({ id: 'b' })]);
    // the DHM-linked row asked to go away
    const plan = await planMasterVesselMerge(client, 'TB. TOL LANDAK II', 'TB. TOLLANDAK II');
    calls.length = 0;
    await expect(applyMasterVesselMerge(client, plan)).rejects.toThrow(/merge refused/);
    expect(calls).toEqual([]);
  });
});
