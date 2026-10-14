import { describe, expect, it } from 'vitest';
import {
  buildDischargePortMap,
  canonicalDischargePort,
  dischargePortMapEntries,
  expandDischargePortPicks,
} from './dischargePortMap';

/** A slice of the real Master Port and alias data (migrations 196/197/213): plants SAP names as discharge ports, a Site with and without its port. */
const MASTER = [
  { port: 'PORT BONTANG' },
  { port: 'PORT BATAM' },
  { port: 'PORT DUMAI' },
  { port: 'PORT MARUNDA CENTRAL (MCT)' },
];
const ALIASES = [
  { alias: 'EUP EDIBLE OIL BONTANG', site: 'BONTANG' },
  { alias: 'TSB TRADING PLANT 1', site: 'Bontang' },
  { alias: 'EUP EDIBLE OIL BATAM', site: 'BATAM' },
  // the Site exists but has no "PORT KARAWANG" Master Port: no port is invented
  { alias: 'EUP TRADING PLANT', site: 'KARAWANG' },
  { alias: 'PABRIK SIP', site: null },
];

describe('Discharge port mapping to Master Port', () => {
  const map = buildDischargePortMap(MASTER, ALIASES);

  it('rule 1: a text that is a Master Port, with or without PORT, is that port', () => {
    for (const text of ['PORT BONTANG', 'BONTANG', 'Port of Bontang', 'port  bontang', 'Pelabuhan Bontang']) {
      expect(canonicalDischargePort(map, text)).toBe('PORT BONTANG');
    }
    expect(canonicalDischargePort(map, 'Dumai')).toBe('PORT DUMAI');
  });

  it('rule 2: a plant name that is an alias is the port named PORT <its site>', () => {
    expect(canonicalDischargePort(map, 'EUP EDIBLE OIL BONTANG')).toBe('PORT BONTANG');
    expect(canonicalDischargePort(map, 'tsb trading plant 1')).toBe('PORT BONTANG');
    expect(canonicalDischargePort(map, 'EUP EDIBLE OIL BATAM')).toBe('PORT BATAM');
  });

  it('rule 3: nothing is invented - a Site without its port, an alias without a Site, and an unknown text stay what they are', () => {
    expect(canonicalDischargePort(map, 'EUP TRADING PLANT')).toBe('EUP TRADING PLANT');
    expect(canonicalDischargePort(map, 'PABRIK SIP')).toBe('PABRIK SIP');
    expect(canonicalDischargePort(map, 'Some Jetty 9')).toBe('SOME JETTY 9');
  });

  it('empty is Blank', () => {
    expect(canonicalDischargePort(map, '')).toBe('Blank');
    expect(canonicalDischargePort(map, null)).toBe('Blank');
  });

  it('a name that is itself a Master Port is never re-pointed by an alias of the same name', () => {
    const m = buildDischargePortMap(MASTER, [{ alias: 'PORT DUMAI', site: 'BATAM' }]);
    expect(canonicalDischargePort(m, 'DUMAI')).toBe('PORT DUMAI');
  });

  it('prefers a live Master Port to one deleted in DHM, and the PORT-prefixed name', () => {
    const m = buildDischargePortMap(
      [{ port: 'BONTANG', deleted: true }, { port: 'PORT BONTANG' }, { port: 'PORT BONTANG OLD', deleted: true }],
      [],
    );
    expect(canonicalDischargePort(m, 'bontang')).toBe('PORT BONTANG');
    const onlyDeleted = buildDischargePortMap([{ port: 'PORT KUBU', deleted: true }], []);
    expect(canonicalDischargePort(onlyDeleted, 'kubu')).toBe('PORT KUBU');
  });

  it('an alias whose Site port exists only as a deleted one still maps to it, a live one first', () => {
    const m = buildDischargePortMap([{ port: 'PORT BONTANG', deleted: true }], [{ alias: 'PABRIK APM', site: 'BONTANG' }]);
    expect(canonicalDischargePort(m, 'PABRIK APM')).toBe('PORT BONTANG');
  });
});

describe('Discharge port picks expanded for the SQL', () => {
  const map = buildDischargePortMap(MASTER, ALIASES);

  it('a Master Port pick stands for the port and every plant name that maps to it', () => {
    expect(expandDischargePortPicks(map, ['PORT BONTANG'])).toEqual(['BONTANG', 'EUP EDIBLE OIL BONTANG', 'TSB TRADING PLANT 1']);
  });

  it('an old pick written as the plant name is the same port', () => {
    expect(expandDischargePortPicks(map, ['EUP EDIBLE OIL BONTANG'])).toEqual(expandDischargePortPicks(map, ['PORT BONTANG']));
  });

  it('a text nobody mapped stays one spelling; Blank stays Blank; several picks are united and sorted', () => {
    expect(expandDischargePortPicks(map, ['EUP TRADING PLANT'])).toEqual(['EUP TRADING PLANT']);
    expect(expandDischargePortPicks(map, ['blank'])).toEqual(['Blank']);
    expect(expandDischargePortPicks(map, ['PORT DUMAI', 'EUP TRADING PLANT', 'Blank'])).toEqual(['Blank', 'DUMAI', 'EUP TRADING PLANT']);
    expect(expandDischargePortPicks(map, [])).toEqual([]);
    expect(expandDischargePortPicks(map, ['', '  '])).toEqual([]);
  });

  it('is empty-map safe: the picks are used as spelled (the phase-1 behaviour)', () => {
    const empty = buildDischargePortMap([], []);
    expect(expandDischargePortPicks(empty, ['PORT BONTANG'])).toEqual(['BONTANG']);
  });
});

describe('Discharge port map as the page receives it', () => {
  it('lists every identity with its Master Port, sorted, so a browser can label rows the same way', () => {
    const entries = dischargePortMapEntries(buildDischargePortMap(MASTER, ALIASES));
    expect(entries).toContainEqual({ identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' });
    expect(entries).toContainEqual({ identity: 'BONTANG', canonical: 'PORT BONTANG' });
    expect(entries.map((e) => e.identity)).toEqual([...entries.map((e) => e.identity)].sort((a, b) => a.localeCompare(b)));
    // unmapped texts are not in it
    expect(entries.some((e) => e.identity === 'EUP TRADING PLANT')).toBe(false);
  });
});
