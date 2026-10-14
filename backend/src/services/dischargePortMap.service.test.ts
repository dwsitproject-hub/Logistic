import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import {
  isDischargePortMasterMappingEnabled,
  loadDischargePortMap,
  resolveDischargePortPicks,
} from './dischargePortMap.service';
import { canonicalDischargePort, dischargePortMapEntries } from '../utils/dischargePortMap';

/** What master_loading_ports and discharge_port_aliases hold, in the order the service reads them. */
function givenTables() {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/FROM master_loading_ports/.test(sql)) return { rows: [{ port: 'PORT BONTANG', deleted: false }] };
    if (/FROM discharge_port_aliases/.test(sql)) return { rows: [{ alias: 'EUP EDIBLE OIL BONTANG', site: 'BONTANG' }] };
    return { rows: [] };
  });
}

describe('Discharge Port Master Port mapping switch', () => {
  const saved = process.env.DISCHARGE_PORT_MASTER_MAPPING;
  beforeEach(() => givenTables());
  afterEach(() => {
    if (saved === undefined) delete process.env.DISCHARGE_PORT_MASTER_MAPPING;
    else process.env.DISCHARGE_PORT_MASTER_MAPPING = saved;
  });

  it('is OFF unless the env says true, whatever else it says', () => {
    delete process.env.DISCHARGE_PORT_MASTER_MAPPING;
    expect(isDischargePortMasterMappingEnabled()).toBe(false);
    for (const v of ['', 'false', '0', 'yes', '1', 'on']) {
      process.env.DISCHARGE_PORT_MASTER_MAPPING = v;
      expect(isDischargePortMasterMappingEnabled()).toBe(false);
    }
    for (const v of ['true', 'TRUE', ' True ']) {
      process.env.DISCHARGE_PORT_MASTER_MAPPING = v;
      expect(isDischargePortMasterMappingEnabled()).toBe(true);
    }
  });

  it('OFF: the map is empty and no table is read, so a port is listed and matched as SAP wrote it', async () => {
    delete process.env.DISCHARGE_PORT_MASTER_MAPPING;
    const map = await loadDischargePortMap();
    expect(queryMock).not.toHaveBeenCalled();
    expect(dischargePortMapEntries(map)).toEqual([]);
    // the plant name stays itself; only the spelling folds
    expect(canonicalDischargePort(map, 'EUP EDIBLE OIL BONTANG')).toBe('EUP EDIBLE OIL BONTANG');
    expect(canonicalDischargePort(map, 'Port of Bontang')).toBe('PORT OF BONTANG');
  });

  it('OFF: a pick is only itself - the identity of the spelling - and the map is not even asked for', async () => {
    delete process.env.DISCHARGE_PORT_MASTER_MAPPING;
    expect(await resolveDischargePortPicks(['PORT BONTANG'])).toEqual(['BONTANG']);
    expect(await resolveDischargePortPicks(['EUP EDIBLE OIL BONTANG'])).toEqual(['EUP EDIBLE OIL BONTANG']);
    expect(await resolveDischargePortPicks(['Blank'])).toEqual(['Blank']);
    expect(await resolveDischargePortPicks([])).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('ON: the tables are read and a plant name that is an alias is the port it maps to', async () => {
    process.env.DISCHARGE_PORT_MASTER_MAPPING = 'true';
    const map = await loadDischargePortMap();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(canonicalDischargePort(map, 'EUP EDIBLE OIL BONTANG')).toBe('PORT BONTANG');
    expect(await resolveDischargePortPicks(['PORT BONTANG'])).toEqual(['BONTANG', 'EUP EDIBLE OIL BONTANG']);
  });
});
