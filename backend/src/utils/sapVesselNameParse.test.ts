import { describe, expect, it } from 'vitest';
import { assignPairCode, parseSapVesselName } from './sapVesselNameParse';

describe('parseSapVesselName: one vessel or a tug and a barge, cleaned like the Master Vessel sheet', () => {
  it('splits a pair, settles the prefixes and puts the tug and the barge in their roles', () => {
    const p = parseSapVesselName('TB. ELIZABETH / BG. ASL 78');
    expect(p.kind).toBe('pair');
    expect(p.tug).toMatchObject({ name: 'TB. ELIZABETH', role: 'TB', type: 'TUG BOAT' });
    expect(p.barge).toMatchObject({ name: 'BG. ASL 78', role: 'BG', type: 'BARGE' });
    expect(p.flags).toEqual([]);
  });

  it('adds the space SAP leaves out after the prefix', () => {
    const p = parseSapVesselName('TB.BIMA SAKTI/BG.HM 2301');
    expect(p.tug?.name).toBe('TB. BIMA SAKTI');
    expect(p.barge?.name).toBe('BG. HM 2301');
    expect(parseSapVesselName('TB.KALTIM DOLPHIN 1011/BG. KALTIM').barge?.name).toBe('BG. KALTIM');
  });

  it('finds the barge on the left as well', () => {
    const p = parseSapVesselName('BG. SOLID 10 / TB. ARGO 10');
    expect(p.tug?.name).toBe('TB. ARGO 10');
    expect(p.barge?.name).toBe('BG. SOLID 10');
  });

  it('writes a tongkang (TK. / TKG.) as a barge', () => {
    const p = parseSapVesselName('TK. SHERIN 03/TB. PACIFIC STAR I');
    expect(p.barge).toMatchObject({ name: 'BG. SHERIN 03', role: 'BG' });
    expect(p.tug?.name).toBe('TB. PACIFIC STAR I');
    expect(parseSapVesselName('TKG. PON 1').segments[0].name).toBe('BG. PON 1');
  });

  it('does not read a voyage number as a pair, and does not keep it in the name', () => {
    const p = parseSapVesselName('BG. LUMINOR 6 V.03/22');
    expect(p.kind).toBe('single');
    expect(p.segments[0].name).toBe('BG. LUMINOR 6');
    expect(p.flags).toEqual([]);
    expect(parseSapVesselName('MT. ALISHA V.06/24').segments[0].name).toBe('MT. ALISHA');
  });

  it('flags a name SAP may have cut at 35 characters', () => {
    const p = parseSapVesselName('TB. PRIMA SAKTI VI/BG. PRIMA SAMUDR');
    expect(p.raw.length).toBe(35);
    expect(p.flags).toContain('truncated');
    expect(parseSapVesselName('TB. ELIZABETH / BG. ASL 78').flags).not.toContain('truncated');
  });

  it('takes a side with a prefix it does not know as the barge, and flags it', () => {
    const p = parseSapVesselName('TB. TOL LANDAK VII / OB. FT VI');
    expect(p.tug?.name).toBe('TB. TOL LANDAK VII');
    expect(p.barge?.name).toBe('OB. FT VI');
    expect(p.flags).toContain('unknown_prefix');
  });

  it('reads a voyage number inside a pair as a voyage, not as a third part', () => {
    const p = parseSapVesselName('BG.LUMINOR 9 V23/22 /TB.OPTIMUS 722');
    expect(p.kind).toBe('pair');
    expect(p.barge?.name).toBe('BG. LUMINOR 9');
    expect(p.tug?.name).toBe('TB. OPTIMUS 722');
    expect(p.flags).not.toContain('too_many_segments');
  });

  it('a pair side with no prefix takes the role the other side leaves, and the prefix added is flagged', () => {
    const tugBare = parseSapVesselName('MAS LINES 1003 / BG. CIPTA JAYA X');
    expect(tugBare.tug).toMatchObject({ name: 'TB. MAS LINES 1003', role: 'TB', type: 'TUG BOAT' });
    expect(tugBare.barge?.name).toBe('BG. CIPTA JAYA X');
    expect(tugBare.flags).toEqual(['tug_inferred']);
    expect(parseSapVesselName('TEBAR/BG.TIGA JAYA 58').tug?.name).toBe('TB. TEBAR');

    const bargeBare = parseSapVesselName('TB. ARGO 10 / SOLID 10');
    expect(bargeBare.barge).toMatchObject({ name: 'BG. SOLID 10', role: 'BG' });
    expect(bargeBare.flags).toEqual(['barge_inferred']);
  });

  it('flags a pair whose roles cannot be told', () => {
    expect(parseSapVesselName('TB. A / TB. B').flags).toContain('pair_roles_conflict');
    expect(parseSapVesselName('BG. A / BG. B').flags).toContain('pair_roles_conflict');
  });

  it('a single vessel: prefix settled, upper case, and a missing prefix is flagged, not invented', () => {
    expect(parseSapVesselName('BG GLORY 7').segments[0].name).toBe('BG. GLORY 7');
    const plain = parseSapVesselName('Mel 02');
    expect(plain.segments[0]).toMatchObject({ name: 'MEL 02', prefix: null, role: null });
    expect(plain.flags).toContain('no_prefix');
    expect(parseSapVesselName('MT. ASIKE I').segments[0]).toMatchObject({ type: 'TANKER', role: null });
    expect(parseSapVesselName('SPOB. ABC').segments[0].type).toBe('SPOB');
  });

  it('keeps KLM. / KM. / MV. with their space and flags them: no rule says what they are', () => {
    const p = parseSapVesselName('KLM.KARUNIA ISMI RAHMAT');
    expect(p.segments[0].name).toBe('KLM. KARUNIA ISMI RAHMAT');
    expect(p.flags).toContain('prefix_undecided');
  });

  it('collapses spaces and an empty name is empty', () => {
    expect(parseSapVesselName('  TB.   ARGO   10 /  BG.  SOLID 10 ').tug?.name).toBe('TB. ARGO 10');
    expect(parseSapVesselName('   ').kind).toBe('empty');
    expect(parseSapVesselName(null).flags).toEqual(['empty']);
  });
});

describe('assignPairCode: the one code of a SAP pair goes to the vessel it abbreviates, else the barge', () => {
  it('MMARINA11 is the tug TB. AS MARINA 11 (the barge is AS MARINA 10)', () => {
    expect(assignPairCode('MMARINA11', 'TB. AS MARINA 11', 'BG. AS MARINA 10')).toEqual({ role: 'TB', ambiguous: false });
  });

  it('MLUM5 is the barge BG. LUMINOR 5', () => {
    expect(assignPairCode('MLUM5', 'TB. MAXIMUS 710', 'BG. LUMINOR 5')).toEqual({ role: 'BG', ambiguous: false });
  });

  it('a code built from both names goes to the barge', () => {
    expect(assignPairCode('MELIZ-ASL', 'TB. ELIZABETH', 'BG. ASL 78').role).toBe('BG');
    expect(assignPairCode('MARGOSOLID', 'TB. ARGO 10', 'BG. SOLID 10').role).toBe('BG');
    expect(assignPairCode('MBIMA2301', 'TB. BIMA SAKTI', 'BG. HM 2301').role).toBe('BG');
  });

  it('reports a code that fits both names', () => {
    expect(assignPairCode('MSAMUDRA', 'TB. SAMUDRA 1', 'BG. SAMUDRA 2')).toEqual({ role: 'BG', ambiguous: true });
  });
});
