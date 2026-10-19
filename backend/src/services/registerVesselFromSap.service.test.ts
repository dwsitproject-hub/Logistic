import { describe, expect, it } from 'vitest';
import { registerPairFromSap, registerSingleFromSap } from './registerVesselFromSap.service';
import { vesselKey } from '../utils/sapVesselNameParse';

type Master = {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  vessel_role: string | null;
  vessel_type: string | null;
  vessel_owner: string | null;
  code_status: string;
  review_status: string | null;
  review_reason: string | null;
  review_sap_name: string | null;
  registered_from: string | null;
};

/** The few statements registerVesselFromSap issues, answered from small in-memory tables. */
function fakeDb(initial: Array<Partial<Master> & { vessel_code: string; vessel_name: string; normalized_vessel_name: string }> = [], knownPairNames: string[] = []) {
  let seq = 0;
  const masters: Master[] = initial.map((m) => ({
    id: `m${++seq}`,
    vessel_role: null,
    vessel_type: null,
    vessel_owner: null,
    code_status: 'OFFICIAL',
    review_status: null,
    review_reason: null,
    review_sap_name: null,
    registered_from: null,
    ...m,
  }));
  const aliases: Array<{ master_id: string; code: string; primary: boolean }> = masters.map((m) => ({ master_id: m.id, code: m.vessel_code.toUpperCase(), primary: true }));
  const pairs: Array<{ id: string; pair_code: string; tb: string; bg: string }> = [];
  const pairNames: Array<{ pair_id: string; name: string; key: string }> = knownPairNames.map((n) => ({ pair_id: 'p0', name: n, key: vesselKey(n) }));
  const statements: string[] = [];
  const pick = (m: Master) => ({ id: m.id, vessel_code: m.vessel_code, vessel_name: m.vessel_name, normalized_vessel_name: m.normalized_vessel_name, vessel_role: m.vessel_role });

  const run = async (sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => {
    const text = sql.replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (/FROM master_vessel_code_aliases a INNER JOIN master_vessels mv/i.test(text)) {
      const code = String(params[0]).toUpperCase();
      const alias = aliases.find((a) => a.code === code);
      const m = alias && masters.find((x) => x.id === alias.master_id);
      return { rows: m ? [pick(m)] : [] };
    }
    if (/^SELECT 1 FROM master_vessels WHERE upper\(trim\(vessel_code\)\)/i.test(text)) {
      const code = String(params[0]).toUpperCase();
      return { rows: masters.some((m) => m.vessel_code.toUpperCase() === code) ? [{ '?column?': 1 }] : [] };
    }
    if (/^SELECT id, vessel_code, vessel_name, normalized_vessel_name, vessel_role FROM master_vessels WHERE upper\(trim\(vessel_code\)\)/i.test(text)) {
      const code = String(params[0]).toUpperCase();
      const m = masters.find((x) => x.vessel_code.toUpperCase() === code);
      return { rows: m ? [pick(m)] : [] };
    }
    if (/WHERE normalized_vessel_name = \$1/i.test(text)) {
      const [norm, role] = params as [string, string | null];
      const found = masters.filter((m) => {
        if (m.normalized_vessel_name !== norm) return false;
        if (role === null) return true;
        if (m.vessel_role === role) return true;
        if (m.vessel_role !== null) return false;
        const otherKind = role === 'TB' ? /^(BG|TKG?|MT|SPOB)[. ]/i : /^(TB|MT|SPOB)[. ]/i;
        return !otherKind.test(m.vessel_name);
      });
      found.sort((a, b) => Number(b.vessel_role === role) - Number(a.vessel_role === role));
      return { rows: found[0] ? [pick(found[0])] : [] };
    }
    if (/^INSERT INTO master_vessels/i.test(text)) {
      const p = params as [string, string, string, string | null, string | null, string | null, string, string | null, string | null, string];
      if (masters.some((m) => m.vessel_code === p[0])) return { rows: [] };
      const m: Master = {
        id: `m${++seq}`,
        vessel_code: p[0],
        vessel_name: p[1],
        normalized_vessel_name: p[2],
        vessel_owner: p[3],
        vessel_type: p[4],
        vessel_role: p[5],
        code_status: p[6],
        registered_from: 'sap_auto',
        review_status: p[7],
        review_reason: p[8],
        review_sap_name: p[9],
      };
      masters.push(m);
      return { rows: [pick(m)] };
    }
    if (/^UPDATE master_vessel_code_aliases/i.test(text)) return { rows: [] };
    if (/^INSERT INTO master_vessel_code_aliases/i.test(text)) {
      const [masterId, code, , isPrimary] = params as [string, string, string, boolean];
      const existing = aliases.find((a) => a.code === code.toUpperCase());
      if (existing) existing.master_id = masterId;
      else aliases.push({ master_id: masterId, code: code.toUpperCase(), primary: Boolean(isPrimary) });
      return { rows: [{ inserted: !existing }] };
    }
    if (/FROM vessel_pair_sap_names WHERE normalized_sap_name/i.test(text)) {
      return { rows: pairNames.some((n) => n.key === params[0]) ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM vessel_pair_sap_names n JOIN vessel_pairs p/i.test(text)) {
      const name = pairNames.find((n) => n.key === params[0]);
      const pair = name && pairs.find((p) => p.id === name.pair_id);
      const bg = pair && masters.find((m) => m.id === pair.bg);
      return { rows: bg ? [pick(bg)] : [] };
    }
    if (/pg_advisory_xact_lock/i.test(text)) return { rows: [] };
    if (/FROM vessel_pairs WHERE pair_code ~/i.test(text)) {
      const max = pairs.reduce((a, p) => Math.max(a, Number(p.pair_code.replace(/\D/g, ''))), 0);
      return { rows: [{ next: max + 1 }] };
    }
    if (/^SELECT id FROM vessel_pairs WHERE tb_master_vessel_id/i.test(text)) {
      const p = pairs.find((x) => x.tb === params[0] && x.bg === params[1]);
      return { rows: p ? [{ id: p.id }] : [] };
    }
    if (/^INSERT INTO vessel_pairs/i.test(text)) {
      const p = { id: `p${pairs.length + 1}`, pair_code: String(params[0]), tb: String(params[1]), bg: String(params[2]) };
      pairs.push(p);
      return { rows: [{ id: p.id }] };
    }
    if (/^INSERT INTO vessel_pair_sap_names/i.test(text)) {
      const [pairId, name, key] = params as [string, string, string];
      if (!pairNames.some((n) => n.pair_id === pairId && n.key === key)) pairNames.push({ pair_id: pairId, name, key });
      return { rows: [] };
    }
    throw new Error(`fakeDb: unexpected statement ${text.slice(0, 100)}`);
  };
  return { run, masters, aliases, pairs, pairNames, statements };
}

const byName = (db: ReturnType<typeof fakeDb>, name: string) => db.masters.find((m) => m.vessel_name === name);

describe('registerPairFromSap: the tug, the barge and the pair of a SAP combo name', () => {
  it('creates both vessels cleaned, with their role and type, the pair and the SAP text; a code built from both names goes to the barge', async () => {
    const db = fakeDb();
    await registerPairFromSap({ vessel_code: 'MELIZ-ASL', vessel_name: 'TB.ELIZABETH/BG. ASL 78', vessel_owner: 'pt. owner' }, db.run);

    expect(byName(db, 'TB. ELIZABETH')).toMatchObject({ vessel_role: 'TB', vessel_type: 'TUG BOAT', code_status: 'PROVISIONAL', vessel_owner: 'PT. OWNER', registered_from: 'sap_auto', review_status: null });
    expect(byName(db, 'BG. ASL 78')).toMatchObject({ vessel_role: 'BG', vessel_type: 'BARGE', vessel_code: 'MELIZ-ASL', code_status: 'OFFICIAL' });
    expect(db.pairs).toHaveLength(1);
    expect(db.pairs[0].pair_code).toBe('TBG-001');
    expect(db.pairNames[0].name).toBe('TB.ELIZABETH/BG. ASL 78');
  });

  it('gives the code to the tug when it abbreviates the tug (MMARINA11)', async () => {
    const db = fakeDb();
    await registerPairFromSap({ vessel_code: 'MMARINA11', vessel_name: 'TB. AS MARINA 11 / BG. AS MARINA 10' }, db.run);
    expect(byName(db, 'TB. AS MARINA 11')).toMatchObject({ vessel_code: 'MMARINA11', code_status: 'OFFICIAL' });
    expect(byName(db, 'BG. AS MARINA 10')).toMatchObject({ code_status: 'PROVISIONAL' });
  });

  it('creates only what is missing and never renames or re-roles a vessel it finds', async () => {
    const db = fakeDb([{ vessel_code: 'MSOLID', vessel_name: 'BG. SOLID 10', normalized_vessel_name: 'SOLID 10', vessel_role: 'BG' }]);
    await registerPairFromSap({ vessel_code: 'MSOLID', vessel_name: 'TB. ARGO 10 / BG. SOLID 10' }, db.run);
    expect(db.masters).toHaveLength(2);
    expect(byName(db, 'BG. SOLID 10')).toMatchObject({ id: 'm1', vessel_code: 'MSOLID', registered_from: null });
    expect(byName(db, 'TB. ARGO 10')).toMatchObject({ vessel_role: 'TB' });
    expect(db.pairs).toEqual([expect.objectContaining({ tb: byName(db, 'TB. ARGO 10')!.id, bg: 'm1' })]);
  });

  it('a legacy vessel with no role but a BG. name is not taken for the tug that shares its base name', async () => {
    const db = fakeDb([{ vessel_code: 'MPAC', vessel_name: 'BG. PACIFIC STAR 1', normalized_vessel_name: 'PACIFIC STAR 1' }]);
    await registerPairFromSap({ vessel_code: 'MPACPAIR', vessel_name: 'TB. PACIFIC STAR I / BG. PACIFIC STAR 1' }, db.run);
    expect(byName(db, 'TB. PACIFIC STAR I')).toMatchObject({ vessel_role: 'TB', id: expect.not.stringMatching(/^m1$/) });
    expect(db.pairs).toHaveLength(1);
  });

  it('does nothing but one lookup when the SAP text already belongs to a pair (the common case on thousands of rows)', async () => {
    const db = fakeDb([], ['TB. ARGO 10 / BG. SOLID 10']);
    await registerPairFromSap({ vessel_code: 'MSOLID', vessel_name: 'TB. ARGO 10 / BG. SOLID 10' }, db.run);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toMatch(/FROM vessel_pair_sap_names/);
    expect(db.masters).toHaveLength(0);
  });

  it('a second run of the same name creates nothing more', async () => {
    const db = fakeDb();
    const identity = { vessel_code: 'MELIZ-ASL', vessel_name: 'TB. ELIZABETH / BG. ASL 78' };
    await registerPairFromSap(identity, db.run);
    const masters = db.masters.length;
    await registerPairFromSap(identity, db.run);
    expect(db.masters).toHaveLength(masters);
    expect(db.pairs).toHaveLength(1);
  });

  it('marks what it is unsure of for review: a name that may be cut, and a SAP code another vessel already holds', async () => {
    const cut = fakeDb();
    await registerPairFromSap({ vessel_code: 'MPRIMA6', vessel_name: 'TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR' }, cut.run);
    expect(byName(cut, 'BG. PRIMA SAMUDR')).toMatchObject({ review_status: 'PENDING', review_reason: 'truncated', review_sap_name: 'TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR' });
    expect(byName(cut, 'TB. PRIMA SAKTI VI')).toMatchObject({ review_status: 'PENDING' });

    const held = fakeDb([{ vessel_code: 'MHELD', vessel_name: 'BG. SOMEONE ELSE', normalized_vessel_name: 'SOMEONE ELSE', vessel_role: 'BG' }]);
    await registerPairFromSap({ vessel_code: 'MHELD', vessel_name: 'TB. NEW TUG / BG. NEW BARGE' }, held.run);
    const barge = byName(held, 'BG. NEW BARGE')!;
    expect(barge.code_status).toBe('PROVISIONAL'); // the SAP code was NOT moved
    expect(barge.review_reason).toContain('code_held_by_other');
    expect(held.aliases.find((a) => a.code === 'MHELD')!.master_id).toBe('m1');
  });

  it('creates both vessels of a pair whose roles cannot be told, but no pair, and flags them', async () => {
    const db = fakeDb();
    await registerPairFromSap({ vessel_code: 'MAB', vessel_name: 'TB. ALPHA / TB. BETA' }, db.run);
    expect(db.masters.map((m) => m.vessel_name).sort()).toEqual(['TB. ALPHA', 'TB. BETA']);
    expect(db.pairs).toHaveLength(0);
    expect(db.masters.every((m) => m.review_status === 'PENDING' && m.review_reason?.includes('pair_roles_conflict'))).toBe(true);
  });

  it('numbers the next pair after the ones that exist, and leaves a single vessel name alone', async () => {
    const db = fakeDb();
    await registerPairFromSap({ vessel_code: 'M1', vessel_name: 'TB. A1 / BG. B1' }, db.run);
    await registerPairFromSap({ vessel_code: 'M2', vessel_name: 'TB. A2 / BG. B2' }, db.run);
    expect(db.pairs.map((p) => p.pair_code)).toEqual(['TBG-001', 'TBG-002']);
    const before = db.statements.length;
    await registerPairFromSap({ vessel_code: 'M3', vessel_name: 'BG. SINGLE 9' }, db.run);
    expect(db.statements).toHaveLength(before);
  });
});

describe('registerSingleFromSap: a single vessel nobody has', () => {
  it('is created with its cleaned name and the role and type its prefix says, with no review when nothing is doubtful', async () => {
    const db = fakeDb();
    const resolved = await registerSingleFromSap({ vessel_code: 'MSINGLE1', vessel_name: 'BG.SINGLE 1', vessel_owner: 'pt. x' }, { primaryCode: 'MSINGLE1', codeStatus: 'OFFICIAL' }, db.run);
    expect(resolved).toMatchObject({ created: true, vessel_name: 'BG. SINGLE 1', vessel_code: 'MSINGLE1' });
    expect(byName(db, 'BG. SINGLE 1')).toMatchObject({ vessel_role: 'BG', vessel_type: 'BARGE', review_status: null, vessel_owner: 'PT. X' });
  });

  it('a name with no prefix is created as written, role unknown, and put up for review', async () => {
    const db = fakeDb();
    await registerSingleFromSap({ vessel_code: 'MNOPREF', vessel_name: 'Widmarino 18' }, { primaryCode: 'MNOPREF', codeStatus: 'OFFICIAL' }, db.run);
    expect(byName(db, 'WIDMARINO 18')).toMatchObject({ vessel_role: null, vessel_type: null, review_status: 'PENDING', review_reason: 'no_prefix' });
  });

  it('a provisional code stays provisional', async () => {
    const db = fakeDb();
    await registerSingleFromSap({ vessel_code: null, vessel_name: 'BG. DAHLIA' }, { primaryCode: 'TMP-DAHLIA', codeStatus: 'PROVISIONAL' }, db.run);
    expect(byName(db, 'BG. DAHLIA')).toMatchObject({ vessel_code: 'TMP-DAHLIA', code_status: 'PROVISIONAL' });
  });

  it('finds the barge of a combo name through its pair even when the stump a person merged away no longer exists by name', async () => {
    const db = fakeDb([
      { vessel_code: 'MPRIMASAM6', vessel_name: 'BG. PRIMA SAMUDRA VI', normalized_vessel_name: 'PRIMA SAMUDRA 6', vessel_role: 'BG' },
      { vessel_code: 'MPRIMATUG6', vessel_name: 'TB. PRIMA SAKTI VI', normalized_vessel_name: 'PRIMA SAKTI 6', vessel_role: 'TB' },
    ]);
    db.pairs.push({ id: 'p1', pair_code: 'TBG-001', tb: 'm2', bg: 'm1' });
    db.pairNames.push({ pair_id: 'p1', name: 'TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR', key: vesselKey('TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR') });
    const resolved = await registerSingleFromSap(
      { vessel_code: 'MPRIMA6', vessel_name: 'TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR' },
      { primaryCode: 'MPRIMA6', codeStatus: 'OFFICIAL' },
      db.run,
    );
    expect(resolved).toMatchObject({ created: false, vessel_name: 'BG. PRIMA SAMUDRA VI' });
    expect(db.masters).toHaveLength(2);
  });

  it('for a combo name it creates nothing: it returns the barge that registerPairFromSap made', async () => {
    const db = fakeDb();
    await registerPairFromSap({ vessel_code: 'MELIZ-ASL', vessel_name: 'TB. ELIZABETH / BG. ASL 78' }, db.run);
    const masters = db.masters.length;
    const resolved = await registerSingleFromSap({ vessel_code: 'MELIZ-ASL', vessel_name: 'TB. ELIZABETH / BG. ASL 78' }, { primaryCode: 'MELIZ-ASL', codeStatus: 'OFFICIAL' }, db.run);
    expect(resolved).toMatchObject({ created: false, vessel_name: 'BG. ASL 78' });
    expect(db.masters).toHaveLength(masters);
  });
});
