import { describe, expect, it } from 'vitest';
import {
  ProtectedMasterVesselError,
  assertDeletable,
  describeProtection,
  loadKlipOriginVessels,
  loadMasterVesselProtection,
  splitDeletable,
  type ProtectionFacts,
  type QueryRunner,
} from './masterVesselProtection.service';

const facts = (over: Partial<ProtectionFacts> = {}): ProtectionFacts => ({
  id: 'v1',
  vessel_name: 'BG. METRO 05.35',
  vessel_code: 'TMP-METRO0535',
  shipments_active: 0,
  shipments_cancelled: 0,
  linked_to_dhm: false,
  klip_origin: false,
  ...over,
});

function runner(rows: ProtectionFacts[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: QueryRunner = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      const ids = (params[0] as string[] | undefined) ?? null;
      return { rows: ids ? rows.filter((r) => ids.includes(r.id)) : rows };
    },
  };
  return { db, calls };
}

describe('describeProtection', () => {
  it('protects a vessel that was input in KLIP', () => {
    const p = describeProtection(facts({ klip_origin: true }));
    expect(p.protected).toBe(true);
    expect(p.reasons.map((r) => r.code)).toEqual(['klip_origin']);
    expect(p.klipOrigin).toBe(true);
  });

  it('does NOT protect a vessel the SAP import made - even one shipments use and one DHM knows', () => {
    // These are meant to be replaced by the cleaner master; usage and DHM are facts to report, not reasons to keep a row.
    const p = describeProtection(facts({ shipments_active: 12, shipments_cancelled: 3, linked_to_dhm: true }));
    expect(p.protected).toBe(false);
    expect(p.reasons).toEqual([]);
    expect(p.shipmentsActive).toBe(12);
    expect(p.shipmentsCancelled).toBe(3);
    expect(p.linkedToDhm).toBe(true);
  });

  it('keeps the usage of a protected vessel as a fact, so the migration knows what to repoint', () => {
    const p = describeProtection(facts({ klip_origin: true, shipments_active: 2 }));
    expect(p.protected).toBe(true);
    expect(p.shipmentsActive).toBe(2);
  });

  it('coerces the counts pg may hand back as strings', () => {
    const p = describeProtection(facts({ shipments_active: '4' as unknown as number }));
    expect(p.shipmentsActive).toBe(4);
  });
});

describe('loadMasterVesselProtection / splitDeletable', () => {
  const rows = [
    facts({ id: 'klip', vessel_name: 'BG. METRO 05.35', klip_origin: true }),
    facts({ id: 'sap', vessel_name: 'BG. SAHABAT SETIA 2689', vessel_code: 'MSETIA2689', shipments_active: 45 }),
  ];

  it('asks the database only for the ids it was given, once, and de-duplicated', async () => {
    const { db, calls } = runner(rows);
    const map = await loadMasterVesselProtection(db, ['klip', 'klip', 'sap', ' ']);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([['klip', 'sap']]);
    expect(map.size).toBe(2);
  });

  it('does not touch the database for an empty list', async () => {
    const { db, calls } = runner(rows);
    expect((await loadMasterVesselProtection(db, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('splits what a cleanup may delete from what it may not, and reports ids the database does not know', async () => {
    const { db } = runner(rows);
    const out = await splitDeletable(db, ['klip', 'sap', 'ghost']);
    expect(out.blocked.map((p) => p.id)).toEqual(['klip']);
    expect(out.deletable.map((p) => p.id)).toEqual(['sap']);
    expect(out.missing).toEqual(['ghost']);
  });

  it('assertDeletable throws a named error that lists the protected vessel, and passes for the rest', async () => {
    const { db } = runner(rows);
    await expect(assertDeletable(db, ['sap'])).resolves.toBeUndefined();
    await expect(assertDeletable(db, ['klip', 'sap'])).rejects.toBeInstanceOf(ProtectedMasterVesselError);
    await expect(assertDeletable(db, ['klip'])).rejects.toThrow(/BG\. METRO 05\.35/);
  });
});

describe('the SQL', () => {
  it('counts usage through master_vessel_id, the code (own and alias) and the normalised name', async () => {
    const { db, calls } = runner([]);
    await loadMasterVesselProtection(db, ['x']);
    const sql = calls[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain('s.master_vessel_id = mv.id');
    expect(sql).toContain('master_vessel_code_aliases');
    expect(sql).toContain('normalize_vessel_name(s.vessel_name) = mv.normalized_vessel_name');
    expect(sql).toContain('mv.id = ANY($1::uuid[])');
  });

  it('reads only the flagged rows when listing what a migration has to carry over', async () => {
    const { db, calls } = runner([facts({ klip_origin: true })]);
    const list = await loadKlipOriginVessels(db);
    expect(list).toHaveLength(1);
    expect(calls[0].sql.replace(/\s+/g, ' ')).toContain('COALESCE(mv.klip_origin, FALSE) IS TRUE');
  });
});
