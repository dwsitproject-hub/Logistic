import { describe, expect, it } from 'vitest';
import {
  parseSheetVessel,
  planSheetReplace,
  sheetNumber,
  sheetRole,
  type MasterSnapshot,
  type SheetVessel,
} from './masterVesselSheetReplace.service';
import { normalizeVesselName } from '../utils/vesselNameNormalize';

const sheet = (row: number, B: string, extra: Record<string, string> = {}): SheetVessel =>
  parseSheetVessel({ row, B, ...extra })!;

let seq = 0;
const master = (name: string, extra: Partial<MasterSnapshot> = {}): MasterSnapshot => ({
  id: `m${++seq}`,
  vessel_code: `TMP-${seq}`,
  vessel_name: name,
  normalized_vessel_name: normalizeVesselName(name),
  vessel_role: null,
  vessel_type: null,
  code_status: 'OFFICIAL',
  klip_origin: false,
  dhm_id: null,
  shipments: 0,
  ...extra,
});

describe('parseSheetVessel', () => {
  it('reads the sheet columns, upper-cased, with comma decimals and a code list', () => {
    const v = parseSheetVessel({
      row: 7, A: 'tbg-011', B: 'bg.  as marina 10', E: 'LN12000179', F: 'PT. Maxima Liners', G: '3000', H: 'Barge', I: 'Yes', J: 'dhdb',
      K: 't/c', L: '21,34', M: '79,01', N: 'baja', O: '2003', P: 'MMAR10, mmarina10, MMAR10',
    })!;
    expect(v).toMatchObject({
      pairId: 'TBG-011', name: 'BG. AS MARINA 10', companyCode: 'LN12000179', owner: 'PT. MAXIMA LINERS', capacity: 3000, vesselType: 'BARGE',
      heating: true, lambung: 'DHDB', charter: 'T/C', draft: 21.34, loa: '79.01', hullType: 'BAJA', registrationYear: 2003,
      codes: ['MMAR10', 'MMARINA10'],
    });
  });

  it('a row without a name is no vessel; a charter or year that is not one is left empty', () => {
    expect(parseSheetVessel({ row: 2, B: '  ' })).toBeNull();
    const v = parseSheetVessel({ row: 3, B: 'X', K: 'spot', O: '20' })!;
    expect(v.charter).toBeNull();
    expect(v.registrationYear).toBeNull();
  });

  it('sheetNumber reads 1.234,5 style only when unambiguous', () => {
    expect(sheetNumber('4,88')).toBe(4.88);
    expect(sheetNumber('2277')).toBe(2277);
    expect(sheetNumber('3,000')).toBe(3000);
    expect(sheetNumber('-')).toBeNull();
  });
});

describe('sheetRole', () => {
  it('tug boat is TB, barge is BG, tanker none; a blank type falls back to the name prefix', () => {
    expect(sheetRole({ vesselType: 'TUG BOAT', name: 'TB. A' })).toBe('TB');
    expect(sheetRole({ vesselType: 'BARGE', name: 'BG. A' })).toBe('BG');
    expect(sheetRole({ vesselType: 'TANKER', name: 'MT. A' })).toBeNull();
    expect(sheetRole({ vesselType: null, name: 'TB. A' })).toBe('TB');
  });
});

describe('planSheetReplace', () => {
  it('matches by name, then normalised name, then spelling twin, then SAP code; the rest is created', () => {
    const exact = master('BG. AS MARINA 10');
    const norm = master('AS MARINA 12');
    const twin = master('TB. TOLLANDAK II', { vessel_type: 'TUG BOAT' });
    const byCode = master('SOMETHING ELSE');
    const plan = planSheetReplace(
      [
        sheet(1, 'BG. AS MARINA 10', { H: 'Barge' }),
        sheet(2, 'BG. AS MARINA 12', { H: 'Barge' }),
        sheet(3, 'TB. TOL LANDAK II', { H: 'Tug Boat' }),
        sheet(4, 'BG. NEW NAME', { H: 'Barge', P: 'MCODE1' }),
        sheet(5, 'BG. BRAND NEW', { H: 'Barge' }),
      ],
      [exact, norm, twin, byCode],
      new Map([['MCODE1', byCode.id]]),
    );
    expect(plan.rows.map((r) => [r.action, r.matchedBy, r.master?.id])).toEqual([
      ['update', 'name', exact.id],
      ['update', 'norm', norm.id],
      ['update', 'twin', twin.id],
      ['update', 'code', byCode.id],
      ['create', undefined, undefined],
    ]);
  });

  it('never makes a barge out of a tug with the same base name', () => {
    const tug = master('TB. PACIFIC STAR I', { vessel_role: 'TB', vessel_type: 'TUG BOAT' });
    const plan = planSheetReplace([sheet(1, 'BG. PACIFIC STAR 1', { H: 'Barge' })], [tug], new Map());
    expect(plan.rows[0].action).toBe('create');
  });

  it('a tug and a barge may share a base name (migration 242): both are loaded', () => {
    const plan = planSheetReplace(
      [sheet(1, 'BG. PACIFIC STAR 1', { H: 'Barge' }), sheet(2, 'TB. PACIFIC STAR I', { H: 'Tug Boat' })],
      [],
      new Map(),
    );
    expect(plan.rows.map((r) => [r.action, r.role])).toEqual([
      ['create', 'BG'],
      ['create', 'TB'],
    ]);
  });

  it('two sheet rows with one normalised name AND role: the second is a conflict, not a guess', () => {
    const plan = planSheetReplace(
      [sheet(1, 'TB. HADI 1', { H: 'Tug Boat' }), sheet(2, 'TB. HADI I', { H: 'Tug Boat' })],
      [],
      new Map(),
    );
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'conflict']);
  });

  it('a code two sheet rows list goes to neither', () => {
    const plan = planSheetReplace(
      [sheet(1, 'BG. AS GLORY 7', { P: 'MGLORY7, MASGLORY' }), sheet(2, 'BG. GLORY 7', { P: 'MGLORY7' })],
      [],
      new Map(),
    );
    expect(plan.rows[0].sharedCodes).toEqual(['MGLORY7']);
    expect(plan.rows[0].codes).toEqual([{ code: 'MASGLORY', from: null }]);
    expect(plan.rows[1].codes).toEqual([]);
  });

  it('an unclaimed master holding a code: the sheet vessel matched by name takes the code, and its shipments follow', () => {
    const glory = master('BG. GLORY 7');
    const oldHolder = master('AS GLORY 7 (OLD)', { shipments: 3 });
    const plan = planSheetReplace([sheet(1, 'BG. GLORY 7', { P: 'MASGLORY' })], [glory, oldHolder], new Map([['MASGLORY', oldHolder.id]]));
    expect(plan.rows[0]).toMatchObject({ action: 'update', matchedBy: 'name', master: glory });
    expect(plan.rows[0].codes).toEqual([{ code: 'MASGLORY', from: oldHolder }]);
    expect(plan.retire).toEqual([expect.objectContaining({ master: oldHolder, action: 'repoint', target: plan.rows[0].sheet })]);
  });

  it('a master claimed by an earlier row is not taken again through its code: the later row is created and the code moves', () => {
    const holder = master('BG. HOLDER');
    const plan = planSheetReplace(
      [sheet(1, 'BG. HOLDER', { P: 'MOWN' }), sheet(2, 'BG. SOMEONE ELSE', { P: 'MHOLD' })],
      [holder],
      new Map([['MHOLD', holder.id], ['MOWN', holder.id]]),
    );
    expect(plan.rows.map((r) => r.action)).toEqual(['update', 'create']);
    expect(plan.rows[1].codes).toEqual([{ code: 'MHOLD', from: holder }]);
    expect(plan.retire).toEqual([]);
  });

  it('a master holding only another row\'s code goes to that row even when its name is a sheet row without codes', () => {
    const holder = master('BG. HOLDER');
    const plan = planSheetReplace(
      [sheet(1, 'BG. HOLDER'), sheet(2, 'BG. SOMEONE ELSE', { P: 'MHOLD' })],
      [holder],
      new Map([['MHOLD', holder.id]]),
    );
    expect(plan.rows.map((r) => [r.action, r.matchedBy])).toEqual([['create', undefined], ['update', 'code']]);
  });

  it('a master the sheet does not have: a KLIP-added one and one still used are kept, an unused one is archived', () => {
    const added = master('ADDED IN KLIP', { klip_origin: true });
    const used = master('USED BY SHIPMENTS', { shipments: 2 });
    const unused = master('NOBODY');
    const plan = planSheetReplace([], [added, used, unused], new Map());
    expect(plan.retire.map((r) => [r.master.id, r.action])).toEqual([
      [added.id, 'keep'],
      [used.id, 'keep'],
      [unused.id, 'archive'],
    ]);
  });

  it('an unclaimed spelling twin of a loaded sheet vessel is merged into it (shipments and codes follow), not kept', () => {
    const sheetVessel = master('BG. JAYASEJAHTERA I');
    const twin = master('BG. JAYA SEJAHTERA I', { shipments: 2 });
    const plan = planSheetReplace([sheet(1, 'BG. JAYASEJAHTERA I', { H: 'Barge' })], [sheetVessel, twin], new Map());
    expect(plan.rows[0]).toMatchObject({ action: 'update', master: sheetVessel });
    expect(plan.retire).toEqual([expect.objectContaining({ master: twin, action: 'repoint', target: plan.rows[0].sheet })]);
  });

  it('a pair whose member is a reported conflict is incomplete, not a failure', () => {
    const plan = planSheetReplace(
      [
        sheet(1, 'TB. HADI 1', { H: 'Tug Boat' }),
        sheet(2, 'TB. HADI I', { A: 'TBG-046', H: 'Tug Boat' }),
        sheet(3, 'BG. MARINI I', { A: 'TBG-046', H: 'Barge' }),
      ],
      [],
      new Map(),
    );
    expect(plan.pairs).toEqual([expect.objectContaining({ pairCode: 'TBG-046', ok: false })]);
    expect(plan.pairs[0].reason).toContain('konflik');
  });

  it('of two masters with the sheet name, the one holding another row\'s code is left for that row', () => {
    const stale = master('BG. PACIFIC STAR 3'); // MED PACIFIC under a stale name, created first
    const real = master('BG. PACIFIC STAR 3');
    const plan = planSheetReplace(
      [sheet(1, 'BG. PACIFIC STAR 3', { H: 'Barge' }), sheet(2, 'MED PACIFIC', { P: 'MMEDPA' })],
      [stale, real],
      new Map([['MMEDPA', stale.id]]),
    );
    expect(plan.rows.map((r) => [r.sheet.name, r.action, r.master?.id])).toEqual([
      ['BG. PACIFIC STAR 3', 'update', real.id],
      ['MED PACIFIC', 'update', stale.id],
    ]);
  });

  it('of several spelling twins, the one holding the row\'s own code is taken; the other is merged into it', () => {
    const coded = master('MT. ASIKE 01');
    const other = master('MT. ASIKE 01');
    const plan = planSheetReplace([sheet(1, 'MT. ASIKE I', { H: 'Tanker', P: 'MASIKE' })], [other, coded], new Map([['MASIKE', coded.id]]));
    expect(plan.rows[0]).toMatchObject({ action: 'update', matchedBy: 'twin', master: coded });
    expect(plan.retire).toEqual([expect.objectContaining({ master: other, action: 'repoint' })]);
  });

  it('a master renamed to another vessel (holding only another row\'s code) is no name match: the code owner takes its shipments', () => {
    const stale = master('TB. BEATRICE 01', { shipments: 15 }); // really BG. ASL 78, renamed by a DHM sync
    const asl = master('BG. ASL 78');
    const plan = planSheetReplace(
      [sheet(1, 'TB. BEATRICE 01', { H: 'Tug Boat' }), sheet(2, 'BG. ASL 78', { H: 'Barge', P: 'MELIZ-ASL' })],
      [stale, asl],
      new Map([['MELIZ-ASL', stale.id]]),
    );
    expect(plan.rows.map((r) => [r.sheet.name, r.action, r.master?.id])).toEqual([
      ['TB. BEATRICE 01', 'create', undefined],
      ['BG. ASL 78', 'update', asl.id],
    ]);
    expect(plan.retire).toEqual([expect.objectContaining({ master: stale, action: 'repoint', target: plan.rows[1].sheet })]);
  });

  it('explicit pairs let one barge be in two pairs', () => {
    const plan = planSheetReplace(
      [sheet(1, 'BG. CIPTA JAYA X', { H: 'Barge' }), sheet(2, 'TB. BAHTERA 7', { H: 'Tug Boat' }), sheet(3, 'TB. MAS LINES 1003', { H: 'Tug Boat' })],
      [],
      new Map(),
      [
        { pairCode: 'TBG-002', tb: 'TB. BAHTERA 7', bg: 'BG. CIPTA JAYA X' },
        { pairCode: 'TBG-144', tb: 'TB. MAS LINES 1003', bg: 'BG. CIPTA JAYA X' },
      ],
    );
    expect(plan.pairs.map((p) => [p.pairCode, p.ok, p.tb?.name, p.bg?.name])).toEqual([
      ['TBG-002', true, 'TB. BAHTERA 7', 'BG. CIPTA JAYA X'],
      ['TBG-144', true, 'TB. MAS LINES 1003', 'BG. CIPTA JAYA X'],
    ]);
  });

  it('a tug whose combo code the barge of its pair now owns is still that tug, matched by name', () => {
    const tug = master('TB. AS MARINA 9', { vessel_role: 'TB', vessel_code: 'MMARINA9' });
    const plan = planSheetReplace(
      [sheet(1, 'BG. AS MARINA 12', { H: 'Barge', P: 'MMARINA9' }), sheet(2, 'TB. AS MARINA 9', { H: 'Tug Boat' })],
      [tug],
      new Map([['MMARINA9', tug.id]]),
      [{ pairCode: 'TBG-010', tb: 'TB. AS MARINA 9', bg: 'BG. AS MARINA 12' }],
    );
    expect(plan.rows[1]).toMatchObject({ action: 'update', matchedBy: 'name', master: tug });
    expect(plan.rows[0]).toMatchObject({ action: 'create', codes: [{ code: 'MMARINA9', from: tug }] });
    expect(plan.retire).toEqual([]);
  });

  it('of two masters with the same name, the one holding the own code of the row is taken', () => {
    const bare = master('BG. ARCINDO 2');
    const coded = master('BG. ARCINDO 2', { vessel_role: 'BG', vessel_code: 'MARCIN1' });
    const plan = planSheetReplace([sheet(1, 'BG. ARCINDO 2', { H: 'Barge', P: 'MARCIN1' })], [bare, coded], new Map([['MARCIN1', coded.id]]));
    expect(plan.rows[0]).toMatchObject({ action: 'update', master: coded });
    expect(plan.retire).toEqual([expect.objectContaining({ master: bare, action: 'repoint' })]);
  });

  it('lists the codes more than one sheet row claims, so a merged twin does not hand them out', () => {
    const plan = planSheetReplace([sheet(1, 'A', { P: 'MX' }), sheet(2, 'B', { P: 'MX, MY' })], [], new Map());
    expect(plan.sharedCodes).toEqual(['MX']);
  });

  it('a pair needs exactly one tug and one barge', () => {
    const plan = planSheetReplace(
      [
        sheet(1, 'TB. ALPHA', { A: 'TBG-1', H: 'Tug Boat' }),
        sheet(2, 'BG. BETA', { A: 'TBG-1', H: 'Barge' }),
        sheet(3, 'BG. GAMMA', { A: 'TBG-2', H: 'Barge' }),
      ],
      [],
      new Map(),
    );
    expect(plan.pairs.map((p) => [p.pairCode, p.ok])).toEqual([
      ['TBG-1', true],
      ['TBG-2', false],
    ]);
  });
});
