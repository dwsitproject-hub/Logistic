import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJpsPorts, validateJpsPortsValue } from './ports';
import { jpsEnabledPortNames, jpsEnabledPorts, jpsPorts } from './config';

const json = (v: unknown) => JSON.stringify(v);

describe('JPS_PORTS: what an ADMIN can save', () => {
  it('reads a list of Master Ports, upper-cased and trimmed, with the switch', () => {
    const r = parseJpsPorts(json([{ port: ' port bontang ', enabled: true }, { port: 'Port Dumai', enabled: false }]));
    expect(r).toEqual({ ok: true, ports: [{ port: 'PORT BONTANG', enabled: true }, { port: 'PORT DUMAI', enabled: false }] });
  });

  it('says what is wrong, in words', () => {
    expect(validateJpsPortsValue('')).toContain('No ports');
    expect(validateJpsPortsValue('not json')).toContain('not valid JSON');
    expect(validateJpsPortsValue('{}')).toContain('must be a list');
    expect(validateJpsPortsValue(json([{ port: '', enabled: true }]))).toContain('no Master Port name');
    expect(validateJpsPortsValue(json([{ port: 'P', enabled: 'yes' }]))).toContain('enabled must be true or false');
    expect(validateJpsPortsValue(json([{ port: 'P', enabled: true }, { port: 'p ', enabled: false }]))).toContain('listed twice');
    expect(validateJpsPortsValue(json(Array.from({ length: 51 }, (_, i) => ({ port: `PORT ${i}`, enabled: true }))))).toContain('at most 50');
  });

  it('ALL is not a port: there is no "send for every port"', () => {
    expect(validateJpsPortsValue(json([{ port: 'all', enabled: true }]))).toContain('ALL is not a port');
  });

  it('an empty list is valid: it means nothing is sent', () => {
    expect(validateJpsPortsValue('[]')).toBeNull();
  });

  it('refuses a name with an invisible or non-ASCII character (copied from a chat app)', () => {
    expect(validateJpsPortsValue(json([{ port: 'PORT DUMAI​', enabled: true }]))).toContain('non-ASCII');
  });
});

describe('jpsPorts(): only what the setting says (no port is built into the code)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.JPS_PORTS;
    // the settings this replaced are no longer read
    process.env.JPS_REGION_SITE = 'KUMAI';
    process.env.JPS_DISCHARGE_PORT = 'PORT KUMAI';
    process.env.JPS_SITES = json([{ site: 'X', port: 'PORT X', enabled: true }]);
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('with nothing saved there is no port, so nothing is sent', () => {
    expect(jpsPorts()).toEqual([]);
    expect(jpsEnabledPorts()).toEqual([]);
    expect(jpsEnabledPortNames()).toEqual([]);
  });

  it('an unreadable value is no port either, never a guess', () => {
    process.env.JPS_PORTS = 'garbage';
    expect(jpsPorts()).toEqual([]);
  });

  it('only the ports switched on are swept', () => {
    process.env.JPS_PORTS = json([{ port: 'PORT BONTANG', enabled: true }, { port: 'PORT DUMAI', enabled: false }]);
    expect(jpsEnabledPortNames()).toEqual(['PORT BONTANG']);
    expect(jpsPorts().map((p) => p.port)).toEqual(['PORT BONTANG', 'PORT DUMAI']);
  });
});
