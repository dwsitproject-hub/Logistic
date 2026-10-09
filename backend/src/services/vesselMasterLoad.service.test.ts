import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  applyVesselLoad,
  decideVessel,
  looseVesselKey,
  planVesselLoad,
  plannedRenames,
  sapNameKey,
  vesselNormName,
  type ExistingMaster,
  type LoadData,
  type LoadVessel,
  type VesselPlan,
} from './vesselMasterLoad.service';

const bg = (over: Partial<LoadVessel> = {}): LoadVessel => ({ role: 'BG', name: 'BG. SOLID 10', codes: [], ...over });
const tb = (over: Partial<LoadVessel> = {}): LoadVessel => ({ role: 'TB', name: 'TB. ARGO 10', codes: [], vesselType: 'TUG BOAT', ...over });
const master = (over: Partial<ExistingMaster> = {}): ExistingMaster => ({
  id: 'm1', vessel_code: 'MSOLID10', vessel_name: 'BG. SOLID 10', normalized_vessel_name: 'SOLID 10',
  vessel_role: null, vessel_type: 'BARGE', code_status: 'OFFICIAL', ...over,
});

describe('decideVessel', () => {
  it('creates a vessel nobody has, and keeps its codes', () => {
    const d = decideVessel(bg({ codes: ['mlum5', 'MLUMIN5'] }), [], new Map());
    expect(d).toMatchObject({ action: 'create', codes: ['MLUM5', 'MLUMIN5'], skippedCodes: [] });
  });

  it('reuses a compatible existing vessel (same base name, no role yet) instead of creating a twin', () => {
    expect(decideVessel(bg(), [master()], new Map()).action).toBe('exists');
    expect(decideVessel(bg(), [master({ vessel_role: 'BG' })], new Map()).action).toBe('exists');
  });

  it('refuses to merge a tug into a barge (or the reverse) that shares the base name once TB./BG. is stripped', () => {
    const asBarge = decideVessel(tb({ name: 'TB. SOLID 10' }), [master()], new Map());
    expect(asBarge.action).toBe('conflict');
    expect(asBarge.reasons.join(' ')).toMatch(/BARGE/);
    expect(decideVessel(bg(), [master({ vessel_role: 'TB', vessel_type: 'TUG BOAT' })], new Map()).action).toBe('conflict');
    expect(decideVessel(tb({ name: 'TB. SOLID 10' }), [master({ vessel_type: 'TUG BOAT' })], new Map()).action).toBe('exists');
  });

  it('leaves a SAP code with the vessel that already holds it, and keeps one it already holds itself', () => {
    const owners = new Map([['MLUM5', 'SINAR KAPUAS 68'], ['MSOLID10', 'SOLID 10']]);
    const d = decideVessel(bg({ codes: ['MLUM5', 'MSOLID10'] }), [master()], owners);
    expect(d.skippedCodes).toEqual([{ code: 'MLUM5', heldBy: 'SINAR KAPUAS 68' }]);
    expect(d.codes).toEqual(['MSOLID10']);
  });

  it('compares names the way the master does: prefix and punctuation do not matter', () => {
    expect(vesselNormName('BG. SOLID 10')).toBe(vesselNormName('bg solid 10'));
    expect(sapNameKey('TB. ARGO 10 / BG SOLID 10')).toBe('TBARGO10BGSOLID10');
  });
});

/** A client that answers the SQL the loader and resolveMasterVessel issue from nothing, and records every statement. */
function emptyDbClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/INSERT INTO master_vessels/i.test(sql)) {
      return { rows: [{ id: `id-${String(params[0])}`, vessel_code: params[0], vessel_name: params[1], normalized_vessel_name: params[2], inserted: true }] };
    }
    if (/INSERT INTO master_vessel_code_aliases/i.test(sql)) return { rows: [{ inserted: true }] };
    if (/INSERT INTO vessel_pairs/i.test(sql)) return { rows: [{ id: 'pair-1', inserted: true }] };
    return { rows: [] };
  };
  return { client: { query } as unknown as PoolClient, calls };
}

describe('applyVesselLoad', () => {
  const data: LoadData = {
    vessels: [tb(), bg({ owner: 'PT. ARGO', capacity: 2500, vesselType: 'BARGE' })],
    pairs: [{ pairCode: 'TBG-001', tb: 'TB. ARGO 10', bg: 'BG. SOLID 10', lastContractDate: '2026-01-30', sapRows2026: 1, sapNames: ['TB ARGO 10/BG SOLID 10'] }],
  };
  const plans = (d: LoadData): VesselPlan[] => d.vessels.map((vessel) => ({ vessel, decision: decideVessel(vessel, [], new Map()) }));

  it('creates a tug and a barge without codes as provisional vessels, marks their role, and links the pair with its SAP name', async () => {
    const { client, calls } = emptyDbClient();
    const out = await applyVesselLoad(client, data, plans(data));
    expect(out).toMatchObject({ created: 2, conflicts: 0, pairsCreated: 1, pairsSkipped: [] });

    const inserts = calls.filter((c) => /INSERT INTO master_vessels/i.test(c.sql));
    expect(inserts.map((c) => c.params[0])).toEqual(['TMP-ARGO10', 'TMP-SOLID10']); // provisional placeholders, no SAP code invented
    expect(inserts.map((c) => c.params[10])).toEqual(['PROVISIONAL', 'PROVISIONAL']);

    const roles = calls.filter((c) => /vessel_role = COALESCE/i.test(c.sql)).map((c) => c.params[1]);
    expect(roles).toEqual(['TB', 'BG']);

    const pair = calls.find((c) => /INSERT INTO vessel_pairs/i.test(c.sql))!;
    expect(pair.params.slice(0, 3)).toEqual(['TBG-001', 'id-TMP-ARGO10', 'id-TMP-SOLID10']);
    const sapName = calls.find((c) => /INSERT INTO vessel_pair_sap_names/i.test(c.sql))!;
    expect(sapName.params).toEqual(['pair-1', 'TB ARGO 10/BG SOLID 10', 'TBARGO10BGSOLID10']);
  });

  it('only fills EMPTY fields of an existing vessel (COALESCE keeps what is there)', async () => {
    const { client, calls } = emptyDbClient();
    const exists: VesselPlan = { vessel: bg({ owner: 'PT. NEW OWNER' }), decision: decideVessel(bg(), [master()], new Map()) };
    await applyVesselLoad(client, { vessels: [exists.vessel], pairs: [] }, [exists]);
    const gap = calls.find((c) => /vessel_role = COALESCE/i.test(c.sql))!;
    expect(gap.sql).toMatch(/vessel_owner = COALESCE\(NULLIF\(trim\(vessel_owner\), ''\), \$3\)/);
    expect(calls.some((c) => /INSERT INTO master_vessels/i.test(c.sql))).toBe(false);
  });

  it('skips a pair whose vessel was held back as a conflict, and says so', async () => {
    const { client } = emptyDbClient();
    const conflict: VesselPlan = { vessel: tb(), decision: { action: 'conflict', codes: [], skippedCodes: [], reasons: ['x'] } };
    const ok: VesselPlan = { vessel: bg(), decision: decideVessel(bg(), [], new Map()) };
    const out = await applyVesselLoad(client, data, [conflict, ok]);
    expect(out.conflicts).toBe(1);
    expect(out.pairsCreated).toBe(0);
    expect(out.pairsSkipped[0]).toMatchObject({ pairCode: 'TBG-001' });
    expect(out.pairsSkipped[0].reason).toMatch(/TB belum ada/);
  });
});

/** A client for planVesselLoad: no vessel and no code exists yet. */
const nothingExistsClient = { query: async () => ({ rows: [] }) } as unknown as PoolClient;

describe('planVesselLoad: the file against itself', () => {
  it('reads a roman numeral and its digit as the same vessel (HADI I / HADI 1) and loads it once', async () => {
    const data: LoadData = { vessels: [tb({ name: 'TB. HADI I' }), tb({ name: 'TB. HADI 1' })], pairs: [] };
    const plans = await planVesselLoad(nothingExistsClient, data);
    expect(plans.map((p) => p.decision.action)).toEqual(['create', 'duplicate']);
    expect(plans[1].decision.duplicateOf).toBe('TB. HADI I');
  });

  it('refuses a tug and a barge of the same file that share a base name, instead of letting the second land on the first row', async () => {
    const data: LoadData = { vessels: [tb({ name: 'TB. AS MARINA 12' }), bg({ name: 'BG. AS MARINA 12' })], pairs: [] };
    const plans = await planVesselLoad(nothingExistsClient, data);
    expect(plans.map((p) => p.decision.action)).toEqual(['create', 'conflict']);
    expect(plans[1].decision.reasons.join(' ')).toMatch(/file yang sama/);
  });

  it('maps both spellings of a duplicate to the same master row, and counts it once as created', async () => {
    const { client } = emptyDbClient();
    const data: LoadData = {
      vessels: [tb({ name: 'TB. HADI I' }), tb({ name: 'TB. HADI 1' }), bg()],
      pairs: [
        { pairCode: 'TBG-A', tb: 'TB. HADI I', bg: 'BG. SOLID 10', sapNames: [] },
        { pairCode: 'TBG-B', tb: 'TB. HADI 1', bg: 'BG. SOLID 10', sapNames: [] },
      ],
    };
    const plans = await planVesselLoad(nothingExistsClient, data);
    const out = await applyVesselLoad(client, data, plans);
    expect(out).toMatchObject({ created: 2, duplicates: 1, failed: [] });
    expect(out.ids.get('TB|' + vesselNormName('TB. HADI I'))).toBe(out.ids.get('TB|' + vesselNormName('TB. HADI 1')));
  });
});

describe('renaming the vessels that are already in the master', () => {
  const messy = master({ vessel_name: 'BG.BOSS 3', normalized_vessel_name: 'BOSS 3' });
  const plan = (): VesselPlan => ({ vessel: bg({ name: 'BG. BOSS 3' }), decision: decideVessel(bg({ name: 'BG. BOSS 3' }), [messy], new Map()) });

  it('lists the stored names that differ from the clean one', () => {
    expect(plannedRenames([plan()])).toEqual([{ from: 'BG.BOSS 3', to: 'BG. BOSS 3' }]);
    const same: VesselPlan = { vessel: bg(), decision: decideVessel(bg(), [master()], new Map()) };
    expect(plannedRenames([same])).toEqual([]);
  });

  it('changes only the name, and only when asked', async () => {
    const off = emptyDbClient();
    await applyVesselLoad(off.client, { vessels: [plan().vessel], pairs: [] }, [plan()]);
    expect(off.calls.some((c) => /SET vessel_name = \$2/.test(c.sql))).toBe(false);

    const on = emptyDbClient();
    await applyVesselLoad(on.client, { vessels: [plan().vessel], pairs: [] }, [plan()], { renameExisting: true });
    const rename = on.calls.find((c) => /SET vessel_name = \$2/.test(c.sql))!;
    expect(rename.sql).not.toMatch(/normalized_vessel_name/); // matching key untouched
    expect(rename.params).toEqual(['m1', 'BG. BOSS 3']);
  });
});

describe('the same vessel under another spelling (what DHM caught on SIT)', () => {
  const dhmKnown = master({
    id: 'dhm1', vessel_code: 'VSL-2455', vessel_name: 'TB. TOL LANDAK II', normalized_vessel_name: 'TOL LANDAK 2', vessel_type: null,
  });
  /** a client that knows exactly these master rows (the exact-name query gets the matching ones, the full list gets all) */
  const knows = (rows: ExistingMaster[]) =>
    ({
      query: async (sql: string, params: unknown[] = []) => {
        if (/master_vessel_code_aliases/i.test(sql)) return { rows: [] };
        if (/normalized_vessel_name = ANY/i.test(sql)) return { rows: rows.filter((r) => (params[0] as string[]).includes(r.normalized_vessel_name)) };
        return { rows };
      },
    }) as unknown as PoolClient;

  it('reads spaces and leading zeros as no difference', () => {
    expect(looseVesselKey(vesselNormName('TB. TOLLANDAK II'))).toBe(looseVesselKey(vesselNormName('TB. TOL LANDAK II')));
    expect(looseVesselKey(vesselNormName('BG. OV - 01'))).toBe(looseVesselKey(vesselNormName('BG. OV-1')));
    expect(looseVesselKey('LUMINOR 10')).not.toBe(looseVesselKey('LUMINOR 1'));
    expect(looseVesselKey('AS MARINA 9')).not.toBe(looseVesselKey('AS MARINA 90'));
  });

  it('does not create a twin of a vessel the master already has under another spelling: it reports it', async () => {
    const plans = await planVesselLoad(knows([dhmKnown]), { vessels: [tb({ name: 'TB. TOLLANDAK II' })], pairs: [] });
    expect(plans[0].decision.action).toBe('conflict');
    expect(plans[0].decision.reasons.join(' ')).toMatch(/TOL LANDAK II/);
  });

  it('keeps loading a vessel that exists exactly, and lists the other spelling as a possible twin', async () => {
    const ours = master({ id: 'ours', vessel_name: 'TB. TOLLANDAK II', normalized_vessel_name: 'TOLLANDAK 2', vessel_code: 'MLANDAK2', vessel_type: null });
    const plans = await planVesselLoad(knows([ours, dhmKnown]), { vessels: [tb({ name: 'TB. TOLLANDAK II' })], pairs: [] });
    expect(plans[0].decision.action).toBe('exists');
    expect(plans[0].decision.twins?.map((t) => t.vessel_name)).toEqual(['TB. TOL LANDAK II']);
  });
});
