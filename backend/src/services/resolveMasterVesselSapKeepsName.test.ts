import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));

import { resolveMasterVessel } from './resolveMasterVessel.service';

// the vessel KLIP has (BG. SERASI VII holding MSERASI); SAP / a shipment row brings the same code under another name
const known = { id: 'mv-1', vessel_code: 'MSERASI', vessel_name: 'BG. SERASI VII', normalized_vessel_name: 'SERASI 7', code_status: 'OFFICIAL' };
const updates = () => queryMock.mock.calls.filter((c) => /^\s*UPDATE master_vessels SET/.test(String(c[0])));

describe('resolveMasterVessel: SAP never renames a vessel KLIP has (the Master Vessel sheet is the source)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM master_vessel_code_aliases/.test(sql) && /JOIN|master_vessels/.test(sql)) return { rows: [known] };
      return { rows: [] };
    });
  });

  it('sap_import keeps the name and only fills empty attributes', async () => {
    const r = await resolveMasterVessel({
      vessel_code: 'MSERASI', vessel_name: 'BG. SERASI 17', vessel_owner: 'PT. OTHER', source: 'sap_import', updateAttributes: true,
    });
    expect(r?.vessel_name).toBe('BG. SERASI VII');
    const sql = String(updates()[0][0]);
    expect(sql).not.toContain("vessel_name = COALESCE(NULLIF(trim($2), ''), vessel_name)");
    expect(sql).toContain("vessel_owner = COALESCE(NULLIF(trim(vessel_owner), ''), NULLIF(trim($4), ''))");
  });

  it('an edit from KLIP (manual) still writes the name', async () => {
    await resolveMasterVessel({ vessel_code: 'MSERASI', vessel_name: 'BG. SERASI 17', source: 'manual', updateAttributes: true });
    expect(String(updates()[0][0])).toContain("vessel_name = COALESCE(NULLIF(trim($2), ''), vessel_name)");
  });
});
