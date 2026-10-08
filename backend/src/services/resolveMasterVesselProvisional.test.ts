import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { resolveMasterVessel } from './resolveMasterVessel.service';
import { officialVesselCodeOrNull } from '../utils/vesselNameNormalize';
import { toDhmVesselPayload } from '../dhm/mapper';

type Vessel = { id: string; vessel_code: string; vessel_name: string; normalized_vessel_name: string; code_status: string };

/** A client that answers the SQL resolveMasterVessel issues from a small in-memory state, and records every statement. */
function fakeClient(vessels: Vessel[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM master_vessel_code_aliases a\s+INNER JOIN/i.test(sql)) return { rows: [] };
    if (/FROM master_vessels\s+WHERE upper\(trim\(vessel_code\)\)/i.test(sql)) {
      const code = String(params[0]).toUpperCase();
      return { rows: vessels.filter((v) => v.vessel_code.toUpperCase() === code) };
    }
    if (/WHERE normalized_vessel_name = \$1/i.test(sql)) {
      return { rows: vessels.filter((v) => v.normalized_vessel_name === params[0]) };
    }
    if (/INSERT INTO master_vessels/i.test(sql)) {
      const row = {
        id: 'new-id',
        vessel_code: String(params[0]),
        vessel_name: String(params[1]),
        normalized_vessel_name: String(params[2]),
        inserted: true,
      };
      return { rows: [row] };
    }
    if (/INSERT INTO master_vessel_code_aliases/i.test(sql)) return { rows: [{ inserted: true }] };
    return { rows: [] }; // UPDATEs
  };
  return { client: { query } as unknown as PoolClient, calls };
}

describe('a vessel created without a SAP code', () => {
  it('is stored PROVISIONAL under a TMP- placeholder, never as an official code', async () => {
    const { client, calls } = fakeClient([]);
    const resolved = await resolveMasterVessel(
      { vessel_code: officialVesselCodeOrNull(undefined), vessel_name: 'bg. dahlia', source: 'manual', updateAttributes: true, code_status: 'PROVISIONAL' },
      client,
    );
    expect(resolved?.created).toBe(true);
    expect(resolved?.vessel_code).toBe('TMP-DAHLIA');
    const insert = calls.find((c) => /INSERT INTO master_vessels/i.test(c.sql))!;
    expect(insert.params[0]).toBe('TMP-DAHLIA'); // vessel_code
    expect(insert.params[10]).toBe('PROVISIONAL'); // code_status
  });

  it('is promoted to OFFICIAL when the SAP import brings the same vessel name with a code', async () => {
    const existing: Vessel = {
      id: 'v1',
      vessel_code: 'TMP-DAHLIA',
      vessel_name: 'BG. DAHLIA',
      normalized_vessel_name: 'DAHLIA',
      code_status: 'PROVISIONAL',
    };
    const { client, calls } = fakeClient([existing]);
    const resolved = await resolveMasterVessel(
      { vessel_code: 'MDAHLIA1', vessel_name: 'BG DAHLIA', source: 'sap_import', updateAttributes: true, code_status: 'OFFICIAL' },
      client,
    );
    expect(resolved?.master_vessel_id).toBe('v1');
    expect(resolved?.created).toBe(false);
    expect(resolved?.vessel_code).toBe('MDAHLIA1');
    const promotion = calls.find((c) => /vessel_code = \$1[\s\S]*code_status = 'OFFICIAL'/i.test(c.sql));
    expect(promotion, 'a promoting UPDATE was issued').toBeDefined();
    expect(promotion!.params[0]).toBe('MDAHLIA1');
    expect(promotion!.params[3]).toBe('v1');
    // the SAP code becomes the vessel's primary code, and the placeholder is kept only as an alias
    const aliasInserts = calls.filter((c) => /INSERT INTO master_vessel_code_aliases/i.test(c.sql));
    expect(aliasInserts.map((c) => c.params[1])).toEqual(expect.arrayContaining(['MDAHLIA1', 'TMP-DAHLIA']));
  });

  it('does not rewrite the code of a vessel that already has an official one; the new code only becomes an alias', async () => {
    const existing: Vessel = {
      id: 'v2',
      vessel_code: 'MLUM9',
      vessel_name: 'BG. LUMINOR 9',
      normalized_vessel_name: 'LUMINOR 9',
      code_status: 'OFFICIAL',
    };
    const { client, calls } = fakeClient([existing]);
    const resolved = await resolveMasterVessel(
      { vessel_code: 'MLUMIN9', vessel_name: 'BG LUMINOR 9', source: 'sap_import', updateAttributes: true, code_status: 'OFFICIAL' },
      client,
    );
    expect(resolved?.vessel_code).toBe('MLUM9');
    expect(calls.some((c) => /vessel_code = \$1[\s\S]*code_status = 'OFFICIAL'/i.test(c.sql))).toBe(false);
  });
});

describe('officialVesselCodeOrNull', () => {
  it('returns an uppercased real code, and null for blank, N/A or a provisional placeholder', () => {
    expect(officialVesselCodeOrNull(' mlum9 ')).toBe('MLUM9');
    expect(officialVesselCodeOrNull('')).toBeNull();
    expect(officialVesselCodeOrNull(undefined)).toBeNull();
    expect(officialVesselCodeOrNull('N/A')).toBeNull();
    expect(officialVesselCodeOrNull('#N/A')).toBeNull();
    expect(officialVesselCodeOrNull('tmp-dahlia')).toBeNull();
  });
});

describe('DHM payload for a vessel without a SAP code', () => {
  it('does not send the TMP- placeholder as Vessel_Code_SAP, and still sends a real code', () => {
    const base = { vessel_name: 'BG. DAHLIA', vessel_capacity_mt: null, heating: null, vessel_type: null, lambung_type: null, terms: null };
    expect(toDhmVesselPayload({ ...base, vessel_code: 'TMP-DAHLIA' })).not.toHaveProperty('Vessel_Code_SAP');
    expect(toDhmVesselPayload({ ...base, vessel_code: 'MDAHLIA1' })).toHaveProperty('Vessel_Code_SAP', 'MDAHLIA1');
  });
});
